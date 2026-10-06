// CDP transport: sync reqwest + tungstenite. Launch, wait, call, load.
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{Child, Command};
use std::time::Duration;

/// Chrome executable, every OS: explicit override first, then the
/// usual install spots, then PATH names, then the historical default.
/// Warns (never refuses) below 149 — WebMCP needs the origin trial.
pub fn chrome_exe() -> String {
    if let Ok(p) = std::env::var("AGENT_WEBMCP_CHROME")
        && !p.trim().is_empty() {
            return p;
        }
    #[cfg(windows)]
    {
        for p in [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ] {
            if std::path::Path::new(p).is_file() {
                return p.to_string();
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for p in [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ] {
            if std::path::Path::new(p).is_file() {
                return p.to_string();
            }
        }
    }
    for name in ["chromium", "google-chrome", "chrome", "chrome.exe", "microsoft-edge", "msedge"] {
        if let Some(p) = scan_path(name) {
            check_version(&p);
            return p;
        }
    }
    let fallback = "/usr/bin/chromium".to_string();
    check_version(&fallback);
    fallback
}

/// Find a binary on PATH.
fn scan_path(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let p = dir.join(name);
        if p.is_file() {
            return Some(p.to_string_lossy().to_string());
        }
    }
    None
}

/// Best-effort version check: `--version` major below 149 warns.
/// Refusals would brick future majors; staleness only warns.
fn check_version(exe: &str) {
    let out = std::process::Command::new(exe).arg("--version").output();
    let text = out.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    let major = text
        .split(|c: char| !c.is_ascii_digit()).find(|s| !s.is_empty())
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0);
    if major != 0 && major < 149 {
        eprintln!("agent-webmcp: {exe} reports {major}; WebMCP wants 149+");
    }
}

/// Kill one pid, portable: taskkill takes the tree on Windows (/T);
/// unix single-kill (group kills go through killpg with a marker).
pub fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
    #[cfg(not(windows))]
    {
        // Unix-only by design (Linux-first CLI): SIGKILL via kill(1).
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

pub fn free_port() -> u16 {
    for port in 18711..18731 {
        if std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(50),
        )
        .is_err()
        {
            return port;
        }
    }
    18711
}

pub fn launch_chrome(port: u16, headed: bool, profile: &str) -> anyhow::Result<Child> {
    // One profile = one browser = one cookie jar. The user-data-dir is
    // what keeps parallel browsers from collapsing into Chromium's
    // singleton — without it, a second launch just forwards into the
    // first and headed/headless mix into nonsense.
    let home = std::env::var("HOME").unwrap_or("/tmp".into());
    let dir = format!("{home}/.agent-webmcp/rust/profiles/{profile}");
    std::fs::create_dir_all(&dir)?;
    let mut cmd = Command::new(chrome_exe());
    cmd.arg(format!("--user-data-dir={dir}"));
    cmd.args([
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--enable-features=WebMCP,WebMCPTesting",
        &format!("--remote-debugging-port={port}"),
    ]);
    if headed {
        // A headed window opens at a usable size, not maximized: somebody
        // watching a driven browser wants a window they can move and use
        // alongside their own.
        cmd.arg("--window-size=1000,700");
    } else {
        cmd.args(["--headless=new", "--hide-scrollbars", "--window-size=1440,900"]);
    }
    // Own session + process group on unix: kill_profile takes the
    // whole tree (stray renderers otherwise pile up and wedge the box).
    // The pgid marker tells kill_profile the group kill is safe; browsers
    // from before this change lack it and fall back to single-pid kill.
    // Windows skips this: taskkill /T already takes the tree at kill time.
    // SAFETY: pre_exec runs after fork in the child; setsid is
    // async-signal-safe and touches no locks.
    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            nix::unistd::setsid()
                .map(|_| ())
                .map_err(|_| std::io::Error::other("setsid failed"))
        });
    }
    // Chrome's own log goes to the profile dir: a dead browser must
    // leave evidence instead of silence (stdio=null taught us nothing).
    let log_path = format!("{dir}/chrome.log");
    let out = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(std::process::Stdio::from)
        .unwrap_or(std::process::Stdio::null());
    let err = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map(std::process::Stdio::from)
        .unwrap_or(std::process::Stdio::null());
    let child = cmd.stdout(out).stderr(err).spawn()?;
    // Group-kill marker (unix only: setsid above): this browser owns its
    // process group, so kill_profile may take the whole tree.
    #[cfg(unix)]
    let _ = std::fs::write(format!("{dir}/pgid"), child.id().to_string());
    Ok(child)
}

/// One cheap liveness probe (no wait loop): does the browser answer.
pub fn http_up(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .is_ok()
}

/// Functional tab probe: a browser can answer HTTP/CDP while its
/// renderers are dead. One evaluate round-trip tells the truth.
/// Failure paths only — never per call (every ms is billed).
pub fn tab_alive(ws_url: &str) -> bool {
    call(ws_url, 1, "Runtime.evaluate", r#"{"expression":"1+1","returnByValue":true}"#)
        .map(|v| v["result"]["result"]["value"] == serde_json::json!(2))
        .unwrap_or(false)
}

pub fn wait_http(port: u16) -> anyhow::Result<()> {
    for _ in 0..150 {
        if std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            Duration::from_millis(100),
        )
        .is_ok()
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    anyhow::bail!("chrome never came up on {port}")
}

pub fn http_get(port: u16, path: &str) -> anyhow::Result<String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    Ok(reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?
        .get(url)
        .send()?
        .text()?)
}

/// One CDP round trip. Reads carry a timeout so a silent peer can
/// never wedge the CLI: every read either progresses or the deadline
/// fires. Events for other calls are skipped.
pub fn call(ws_url: &str, id: i64, method: &str, params: &str) -> anyhow::Result<serde_json::Value> {
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    set_timeout(&mut sock, Duration::from_secs(5))?;
    let req = format!(r#"{{"id":{id},"method":"{method}","params":{params}}}"#);
    sock.send(tungstenite::Message::Text(req.into()))?;
    let deadline = std::time::Instant::now() + Duration::from_secs(25);
    loop {
        if std::time::Instant::now() >= deadline {
            anyhow::bail!("cdp {method}: reply timeout");
        }
        match sock.read() {
            Err(tungstenite::Error::Io(e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => anyhow::bail!("cdp {method}: {e}"),
            Ok(tungstenite::Message::Text(t)) => {
                let v: serde_json::Value = serde_json::from_str(&t)?;
                if v.get("id").and_then(|i| i.as_i64()) == Some(id) {
                    if let Some(e) = v.get("error") {
                        anyhow::bail!("cdp error: {e}");
                    }
                    return Ok(v);
                }
            }
            Ok(tungstenite::Message::Ping(p)) => {
                sock.send(tungstenite::Message::Pong(p))?;
            }
            Ok(tungstenite::Message::Close(_)) => anyhow::bail!("ws closed"),
            Ok(_) => {}
        }
    }
}

fn set_timeout(
    sock: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    d: Duration,
) -> anyhow::Result<()> {
    use tungstenite::stream::MaybeTlsStream;
    match sock.get_mut() {
        MaybeTlsStream::Plain(t) => t.set_read_timeout(Some(d))?,
        _ => anyhow::bail!("tls unexpected on local CDP"),
    }
    Ok(())
}

/// Reload the page and wait for load, subscribing BEFORE the reload
/// fires: enable-then-reload on one connection, so a fast cached load
/// cannot slip between trigger and subscribe.
pub fn reload_and_wait(ws_url: &str) -> anyhow::Result<()> {
    use tungstenite::stream::MaybeTlsStream;
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    if let MaybeTlsStream::Plain(t) = sock.get_mut() {
        t.set_read_timeout(Some(Duration::from_secs(2)))?;
    }
    let send = |sock: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>, id: i64, method: &str, params: &str| -> anyhow::Result<()> {
        sock.send(tungstenite::Message::Text(
            format!(r#"{{"id":{id},"method":"{method}","params":{params}}}"#).into(),
        ))?;
        Ok(())
    };
    send(&mut sock, 1, "Page.enable", "{}")?;
    // Drain the enable ack.
    loop {
        match sock.read() {
            Ok(tungstenite::Message::Text(t)) => {
                if t.to_string().contains("\"id\":1") {
                    break;
                }
            }
            Ok(_) => continue,
            Err(_) => break,
        }
    }
    send(&mut sock, 2, "Page.reload", "{}")?;
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(20) {
            anyhow::bail!("load timeout");
        }
        match sock.read() {
            Err(tungstenite::Error::Io(e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => anyhow::bail!("reload: {e}"),
            Ok(tungstenite::Message::Text(t)) => {
                if t.to_string().contains("Page.loadEventFired") {
                    return Ok(());
                }
            }
            Ok(tungstenite::Message::Ping(p)) => {
                sock.send(tungstenite::Message::Pong(p))?;
            }
            Ok(_) => {}
        }
    }
}

/// Navigate and wait for load on one connection: enable first so a
/// fast cached load cannot slip between trigger and subscribe.
pub fn navigate_and_wait(ws_url: &str, url: &str) -> anyhow::Result<()> {
    use tungstenite::stream::MaybeTlsStream;
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    if let MaybeTlsStream::Plain(t) = sock.get_mut() {
        t.set_read_timeout(Some(Duration::from_secs(2)))?;
    }
    let send = |sock: &mut tungstenite::WebSocket<MaybeTlsStream<std::net::TcpStream>>, id: i64, method: &str, params: &str| -> anyhow::Result<()> {
        sock.send(tungstenite::Message::Text(
            format!(r#"{{"id":{id},"method":"{method}","params":{params}}}"#).into(),
        ))?;
        Ok(())
    };
    send(&mut sock, 1, "Page.enable", "{}")?;
    send(&mut sock, 2, "Page.navigate", &format!(r#"{{"url":{url:?}}}"#))?;
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(25) {
            anyhow::bail!("load timeout");
        }
        match sock.read() {
            Err(tungstenite::Error::Io(e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                continue;
            }
            Err(e) => anyhow::bail!("navigate: {e}"),
            Ok(tungstenite::Message::Text(t)) => {
                if t.to_string().contains("Page.loadEventFired") {
                    return Ok(());
                }
            }
            Ok(tungstenite::Message::Ping(p)) => {
                sock.send(tungstenite::Message::Pong(p))?;
            }
            Ok(_) => {}
        }
    }
}
/// Trusted mouse click at viewport coords: pressed + released.
/// CDP-synthesized input counts as a user gesture (popups allowed).
pub fn mouse_click(ws_url: &str, x: f64, y: f64) -> anyhow::Result<()> {
    for typ in ["mousePressed", "mouseReleased"] {
        let p = serde_json::json!({"type": typ, "x": x, "y": y, "button": "left", "clickCount": 1}).to_string();
        call(ws_url, 1, "Input.dispatchMouseEvent", &p)?;
    }
    Ok(())
}

/// Trusted text entry at the focused control.
pub fn insert_text(ws_url: &str, text: &str) -> anyhow::Result<()> {
    let p = serde_json::json!({"text": text}).to_string();
    call(ws_url, 1, "Input.insertText", &p)?;
    Ok(())
}

/// Browser-level debugger URL for Target.* calls.
pub fn browser_ws(port: u16) -> anyhow::Result<String> {
    let v: serde_json::Value = serde_json::from_str(&http_get(port, "/json/version")?)?;
    v.get("webSocketDebuggerUrl")
        .and_then(|w| w.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("no_browser: no debugger url on {port}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dead_tab_reads_dead() {
        // Nothing listens on port 9: the probe must fail fast, not hang.
        assert!(!tab_alive("ws://127.0.0.1:9/nonexistent"));
        assert!(!http_up(9));
    }

    #[test]
    fn chrome_resolves() {
        // SAFETY: single mutation; no other test reads this var.
        unsafe {
            std::env::set_var("AGENT_WEBMCP_CHROME", "/tmp/fake-chrome");
        }
        // Override wins when set.
        assert_eq!(chrome_exe(), "/tmp/fake-chrome".to_string());
        unsafe {
            std::env::remove_var("AGENT_WEBMCP_CHROME");
        }
        // Default resolution never empty on a dev box with a browser.
        assert!(!chrome_exe().is_empty());
    }
}
