// CDP transport: sync reqwest + tungstenite. Launch, wait, call, load.
use std::process::{Child, Command};
use std::time::Duration;

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
    let mut cmd = Command::new("/usr/bin/chromium");
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
    Ok(cmd.stdout(out).stderr(err).spawn()?)
}

/// One cheap liveness probe (no wait loop): does the browser answer.
pub fn http_up(port: u16) -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(300),
    )
    .is_ok()
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

/// Enable Page and block until loadEventFired (20s cap). Reads are
/// timeout-paced so a page that never loads (about:blank) fails fast
/// instead of wedging.
pub fn wait_load(ws_url: &str) -> anyhow::Result<()> {
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    set_timeout(&mut sock, Duration::from_secs(2))?;
    sock.send(tungstenite::Message::Text(
        r#"{"id":1,"method":"Page.enable","params":{}}"#.into(),
    ))?;
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
            Err(e) => anyhow::bail!("load: {e}"),
            Ok(tungstenite::Message::Text(t)) => {
                if t.contains("Page.loadEventFired") {
                    return Ok(());
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

/// Browser-level debugger URL for Target.* calls.
pub fn browser_ws(port: u16) -> anyhow::Result<String> {
    let v: serde_json::Value = serde_json::from_str(&http_get(port, "/json/version")?)?;
    v.get("webSocketDebuggerUrl")
        .and_then(|w| w.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("no_browser: no debugger url on {port}"))
}
