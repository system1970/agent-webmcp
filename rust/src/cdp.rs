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

pub fn launch_chrome(port: u16) -> anyhow::Result<Child> {
    Ok(Command::new("/usr/bin/chromium")
        .args([
            "--headless=new",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-dev-shm-usage",
            &format!("--remote-debugging-port={port}"),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?)
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

/// One CDP round trip. Events for other calls are skipped.
pub fn call(ws_url: &str, id: i64, method: &str, params: &str) -> anyhow::Result<serde_json::Value> {
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    let req = format!(r#"{{"id":{id},"method":"{method}","params":{params}}}"#);
    sock.send(tungstenite::Message::Text(req.into()))?;
    loop {
        match sock.read()? {
            tungstenite::Message::Text(t) => {
                let v: serde_json::Value = serde_json::from_str(&t)?;
                if v.get("id").and_then(|i| i.as_i64()) == Some(id) {
                    if let Some(e) = v.get("error") {
                        anyhow::bail!("cdp error: {e}");
                    }
                    return Ok(v);
                }
            }
            tungstenite::Message::Ping(p) => {
                sock.send(tungstenite::Message::Pong(p))?;
            }
            tungstenite::Message::Close(_) => anyhow::bail!("ws closed"),
            _ => {}
        }
    }
}

/// Enable Page and block until loadEventFired (20s cap).
pub fn wait_load(ws_url: &str) -> anyhow::Result<()> {
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    sock.send(tungstenite::Message::Text(
        r#"{"id":1,"method":"Page.enable","params":{}}"#.into(),
    ))?;
    let start = std::time::Instant::now();
    loop {
        if start.elapsed() > Duration::from_secs(20) {
            anyhow::bail!("load timeout");
        }
        match sock.read()? {
            tungstenite::Message::Text(t) => {
                if t.contains("Page.loadEventFired") {
                    return Ok(());
                }
            }
            tungstenite::Message::Ping(p) => {
                sock.send(tungstenite::Message::Pong(p))?;
            }
            tungstenite::Message::Close(_) => anyhow::bail!("ws closed"),
            _ => {}
        }
    }
}

/// First page target with a debugger URL; polls while Chrome starts.
pub fn first_page(port: u16) -> anyhow::Result<String> {
    for _ in 0..50 {
        let list: serde_json::Value = serde_json::from_str(&http_get(port, "/json/list")?)?;
        if let Some(arr) = list.as_array() {
            for t in arr {
                let is_page = t.get("type").and_then(|k| k.as_str()) == Some("page");
                if is_page {
                    if let Some(ws) = t.get("webSocketDebuggerUrl").and_then(|w| w.as_str()) {
                        if !ws.is_empty() {
                            return Ok(ws.to_string());
                        }
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    anyhow::bail!("no page target")
}
