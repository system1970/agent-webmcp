// WebMCP protocol: discovery (listTools fast path, event drain
// fallback) and invocation (invokeTool, callTool fallback, async
// toolResponded wait). Ported from the Go CLI's webmcp.go, same
// timings: quiet 250ms, cap 900ms — silence means no tools.
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Mirrors the Go CLI's isNotFound: the method-absent family of errors.
fn is_not_found(msg: &str) -> bool {
    let s = msg.to_lowercase();
    [
        "wasn't found",
        "was not found",
        "not found",
        "no such",
        "unsupported",
        "invalid method",
        "method not found",
    ]
    .iter()
    .any(|sub| s.contains(sub))
}
/// A WebMCP session: one websocket, id-routed calls, event drain.
/// Non-reply messages are parked, never dropped: events arriving
/// during a call wait for the drain instead of vanishing.
pub struct Session {
    sock: tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    next_id: i64,
    parked: std::collections::VecDeque<serde_json::Value>,
}

impl Session {
    pub fn connect(ws_url: &str) -> anyhow::Result<Self> {
        let (sock, _) = tungstenite::connect(ws_url)?;
        let mut s = Self { sock, next_id: 0, parked: std::collections::VecDeque::new() };
        s.set_timeout(Duration::from_millis(500))?;
        Ok(s)
    }

    fn set_timeout(&mut self, d: Duration) -> anyhow::Result<()> {
        use tungstenite::stream::MaybeTlsStream;
        match self.sock.get_mut() {
            MaybeTlsStream::Plain(t) => t.set_read_timeout(Some(d))?,
            _ => anyhow::bail!("tls unexpected on local CDP"),
        }
        Ok(())
    }

    /// One call; events for other ids are dropped (callers needing
    /// events use drain_events instead).
    pub fn call(&mut self, method: &str, params: &str) -> anyhow::Result<serde_json::Value> {
        self.next_id += 1;
        let id = self.next_id;
        let req = format!(r#"{{"id":{id},"method":"{method}","params":{params}}}"#);
        self.sock.send(tungstenite::Message::Text(req.into()))?;
        loop {
            match self.sock.read()? {
                tungstenite::Message::Text(t) => {
                    let v: serde_json::Value = serde_json::from_str(&t)?;
                    if v.get("method").is_some() && v.get("id").is_none() {
                        self.parked.push_back(v);
                        continue;
                    }
                    if v.get("id").and_then(|i| i.as_i64()) == Some(id) {
                        if let Some(e) = v.get("error") {
                            let msg = e.get("message").and_then(|m| m.as_str()).unwrap_or("?");
                            if is_not_found(msg) {
                                anyhow::bail!("not_found: {method}");
                            }
                            anyhow::bail!("cdp {method}: {msg}");
                        }
                        return Ok(v);
                    }
                }
                tungstenite::Message::Ping(p) => {
                    self.sock.send(tungstenite::Message::Pong(p))?;
                }
                tungstenite::Message::Close(_) => anyhow::bail!("ws closed"),
                _ => {}
            }
        }
    }
}

/// Fold one CDP message into the tool set. Returns true when the
/// quiet clock resets (a tool event arrived).
fn ingest(
    seen: &mut HashMap<String, (serde_json::Value, String)>,
    v: &serde_json::Value,
) -> bool {
    let method = v.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = match v.get("params") {
        Some(p) => p,
        None => return false,
    };
    let frame = params
        .get("frameId")
        .and_then(|f| f.as_str())
        .unwrap_or("")
        .to_string();
    let tools = params
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    match method {
        "WebMCP.toolsAdded" | "WebMCP.toolsChanged" => {
            for mut tool in tools {
                let name = tool.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                if name.is_empty() {
                    continue;
                }
                let fid = tool
                    .get("frameId")
                    .and_then(|f| f.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&frame)
                    .to_string();
                if tool.get("frameId").is_none() && !fid.is_empty() {
                    tool["frameId"] = serde_json::json!(fid);
                }
                seen.insert(format!("{name}\x00{fid}"), (tool, fid));
            }
            true
        }
        "WebMCP.toolsRemoved" => {
            for tool in tools {
                let name = tool.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let fid = tool
                    .get("frameId")
                    .and_then(|f| f.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&frame);
                seen.remove(&format!("{name}\x00{fid}"));
            }
            true
        }
        _ => false,
    }
}
impl Session {
    /// Drain WebMCP.toolsAdded/Changed/Removed until 250ms quiet or
    /// 900ms cap. Parked events from earlier calls are folded first.
    /// Returns name -> (tool json, frame).
    pub fn drain_tools(
        &mut self,
        cap: Duration,
    ) -> anyhow::Result<HashMap<String, (serde_json::Value, String)>> {
        let quiet = Duration::from_millis(250);
        let deadline = Instant::now() + cap;
        let mut last = Instant::now();
        let mut seen: HashMap<String, (serde_json::Value, String)> = HashMap::new();
        for v in self.parked.drain(..).collect::<Vec<_>>() {
            if ingest(&mut seen, &v) {
                last = Instant::now();
            }
        }
        self.set_timeout(Duration::from_millis(100))?;
        loop {
            if Instant::now() >= deadline || Instant::now().duration_since(last) >= quiet {
                break;
            }
            let msg = match self.sock.read() {
                Ok(m) => m,
                Err(tungstenite::Error::Io(e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    continue;
                }
                Err(e) => anyhow::bail!("drain: {e}"),
            };
            let t = match msg {
                tungstenite::Message::Text(t) => t.to_string(),
                tungstenite::Message::Ping(p) => {
                    self.sock.send(tungstenite::Message::Pong(p))?;
                    continue;
                }
                _ => continue,
            };
            let v: serde_json::Value = match serde_json::from_str(&t) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if ingest(&mut seen, &v) {
                last = Instant::now();
            }
        }
        Ok(seen)
    }

    /// Wait for the toolResponded event matching an invocation id.
    pub fn wait_responded(
        &mut self,
        invocation: &str,
        timeout: Duration,
    ) -> anyhow::Result<serde_json::Value> {
        let deadline = Instant::now() + timeout;
        self.set_timeout(Duration::from_millis(200))?;
        loop {
            if Instant::now() >= deadline {
                anyhow::bail!("timeout: no tool response within budget");
            }
            let msg = match self.sock.read() {
                Ok(m) => m,
                Err(tungstenite::Error::Io(e))
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    continue;
                }
                Err(e) => anyhow::bail!("responded: {e}"),
            };
            let t = match msg {
                tungstenite::Message::Text(t) => t.to_string(),
                tungstenite::Message::Ping(p) => {
                    self.sock.send(tungstenite::Message::Pong(p))?;
                    continue;
                }
                _ => continue,
            };
            let v: serde_json::Value = match serde_json::from_str(&t) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if v.get("method").and_then(|m| m.as_str()) != Some("WebMCP.toolResponded") {
                continue;
            }
            let p = &v["params"];
            if p.get("invocationId").and_then(|i| i.as_str()) != Some(invocation) {
                continue;
            }
            match p.get("status").and_then(|s| s.as_str()).unwrap_or("") {
                "Completed" => {
                    let out = p.get("output").cloned().unwrap_or(serde_json::json!({"ok": true}));
                    return Ok(out);
                }
                "Canceled" => anyhow::bail!("canceled: tool canceled by page"),
                other => {
                    let err = p.get("errorText").and_then(|e| e.as_str()).unwrap_or("");
                    if !err.is_empty() {
                        anyhow::bail!("{err}");
                    }
                    anyhow::bail!("tool failed: {other}");
                }
            }
        }
    }

}

/// List page tools: enable, listTools fast path, event drain fallback.
pub fn list_tools(ws_url: &str) -> anyhow::Result<Vec<(serde_json::Value, String)>> {
    let mut s = Session::connect(ws_url)?;
    let _ = s.call("WebMCP.enable", "{}");
    match s.call("WebMCP.listTools", "{}") {
        Ok(v) => {
            let mut out = vec![];
            if let Some(arr) = v
                .get("result")
                .and_then(|r| r.get("tools"))
                .and_then(|t| t.as_array())
            {
                for tool in arr {
                    let fid = tool
                        .get("frameId")
                        .and_then(|f| f.as_str())
                        .unwrap_or("")
                        .to_string();
                    out.push((tool.clone(), fid));
                }
            }
            return Ok(out);
        }
        Err(e) => {
            if !(e.to_string().contains("not_found") || is_not_found(&e.to_string())) {
                anyhow::bail!("{e:#}");
            }
        }
    }
    let seen = s.drain_tools(Duration::from_millis(900))?;
    Ok(seen.into_values().collect())
}

/// Invoke detached: returns the invocation id immediately while a
/// background daemon holds the connection open for toolResponded and
/// records the outcome to the session dir. Slow tools stop blocking
/// the caller; `result` collects.
///
/// Fork, not thread: the CLI parent may exit at once, and the daemon
/// inherits the connected socket. That inheritance is load-bearing:
/// toolResponded routes to the invoking connection, never to a fresh
/// one (verified: a reconnect waiter never fires). Double fork, so no
/// zombie accumulates under a long-lived MCP server (init reaps).
pub fn invoke_detached(
    ws_url: &str,
    session: &str,
    name: &str,
    params: &serde_json::Value,
    frame: &str,
) -> anyhow::Result<String> {
    let mut s = Session::connect(ws_url)?;
    let _ = s.call("WebMCP.enable", "{}");
    let p = serde_json::json!({"frameId": frame, "toolName": name, "input": params}).to_string();
    let raw = match s.call("WebMCP.invokeTool", &p) {
        Ok(v) => v,
        Err(e) if is_not_found(&e.to_string()) => s.call("WebMCP.callTool", &p)?,
        Err(e) => anyhow::bail!("{e:#}"),
    };
    let id = raw
        .get("result")
        .and_then(|r| r.get("invocationId"))
        .and_then(|i| i.as_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        anyhow::bail!("usage: synchronous result, no detach needed: {raw}");
    }
    let dir = invocation_dir(session)?;
    std::fs::write(
        dir.join(format!("{id}.json")),
        serde_json::json!({"status": "pending", "invocation": id}).to_string(),
    )?;
    daemonize_waiter(s, &id, &dir.join(format!("{id}.json")))?;
    Ok(id)
}

/// Fork the waiter into a daemon (unix). The parent returns at once
/// (dropping its socket copy; the daemon's stays open). The grandchild
/// detaches into its own session, waits up to 120s, writes ready/error,
/// exits. Elsewhere, and when fork fails: thread fallback, which works
/// while the parent outlives the wait (MCP server) and dies with a CLI
/// parent — degraded, never silent.
fn daemonize_waiter(s: Session, id: &str, path: &std::path::Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use nix::unistd::{fork, ForkResult};
        let id = id.to_string();
        let path = path.to_path_buf();
        // SAFETY: fork in a sync single-threaded dispatch path (no locks
        // held, no threads spawned yet on this path). The child only
        // reads one socket, writes one file, and exits.
        match unsafe { fork() } {
            Ok(ForkResult::Parent { child: a }) => {
                // Reap A, which exits right after the second fork.
                let _ = nix::sys::wait::waitpid(a, None);
                Ok(())
            }
            Ok(ForkResult::Child) => match unsafe { fork() } {
                Ok(ForkResult::Parent { .. }) => std::process::exit(0),
                Ok(ForkResult::Child) => {
                    let _ = nix::unistd::setsid();
                    let mut s = s;
                    let outcome = s.wait_responded(&id, Duration::from_secs(120));
                    let ok = outcome.is_ok();
                    let record = match &outcome {
                        Ok(v) => serde_json::json!({"status": "ready", "invocation": id, "result": v}),
                        Err(e) => serde_json::json!({"status": "error", "invocation": id, "error": format!("{e:#}")}),
                    };
                    let _ = std::fs::write(&path, record.to_string());
                    std::process::exit(if ok { 0 } else { 1 });
                }
                Err(_) => std::process::exit(1),
            },
            Err(_) => {
                eprintln!("agent-webmcp: fork failed, thread fallback for {id}");
                thread_waiter(s, &id, &path);
                Ok(())
            }
        }
    }
    #[cfg(not(unix))]
    {
        thread_waiter(s, id, path);
        Ok(())
    }
}

/// Thread waiter: holds the connection open for toolResponded, records
/// the outcome. Primary path off unix, fallback on it.
fn thread_waiter(mut s: Session, id: &str, path: &std::path::Path) {
    let id = id.to_string();
    let path = path.to_path_buf();
    std::thread::spawn(move || {
        let outcome = s.wait_responded(&id, Duration::from_secs(120));
        let record = match outcome {
            Ok(v) => serde_json::json!({"status": "ready", "invocation": id, "result": v}),
            Err(e) => serde_json::json!({"status": "error", "invocation": id, "error": format!("{e:#}")}),
        };
        let _ = std::fs::write(path, record.to_string());
    });
}

fn invocation_dir(session: &str) -> anyhow::Result<std::path::PathBuf> {
    let d = crate::session::home()
        .join(".agent-webmcp/rust")
        .join(session)
        .join("invocations");
    std::fs::create_dir_all(&d)?;
    Ok(d)
}

/// Read a detached invocation record: pending, ready, or error.
pub fn read_result(session: &str, id: &str) -> anyhow::Result<serde_json::Value> {
    let b = std::fs::read_to_string(invocation_dir(session)?.join(format!("{id}.json")))
        .map_err(|_| anyhow::anyhow!("not_found: no invocation {id} for session {session}"))?;
    serde_json::from_str(&b).map_err(|_| anyhow::anyhow!("not_found: unreadable invocation {id}"))
}
/// Invoke a page tool: {frameId, toolName, input} -> invocationId ->
/// toolResponded. Retries once as callTool on older builds.
pub fn invoke_tool(
    ws_url: &str,
    name: &str,
    params: &serde_json::Value,
    frame: &str,
) -> anyhow::Result<serde_json::Value> {
    let mut s = Session::connect(ws_url)?;
    let _ = s.call("WebMCP.enable", "{}");
    let p = serde_json::json!({"frameId": frame, "toolName": name, "input": params}).to_string();
    let raw = match s.call("WebMCP.invokeTool", &p) {
        Ok(v) => v,
        Err(e) if is_not_found(&e.to_string()) => s.call("WebMCP.callTool", &p)?,
        Err(e) => anyhow::bail!("{e:#}"),
    };
    let id = raw
        .get("result")
        .and_then(|r| r.get("invocationId"))
        .and_then(|i| i.as_str())
        .unwrap_or("")
        .to_string();
    if id.is_empty() {
        return Ok(raw); // synchronous result
    }
    s.wait_responded(&id, Duration::from_secs(30))
}
