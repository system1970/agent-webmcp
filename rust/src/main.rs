// Spike 1: Rust talks CDP. Launch headless Chromium, navigate to
// example.com, Runtime.evaluate document.title, print it, exit.
// Sync only: reqwest blocking + tungstenite connect. No async runtime.
use std::process::{Child, Command};
use std::time::Duration;

fn free_port() -> u16 {
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

fn http_get(port: u16, path: &str) -> anyhow::Result<String> {
    let url = format!("http://127.0.0.1:{port}{path}");
    Ok(reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?
        .get(url)
        .send()?
        .text()?)
}

fn wait_http(port: u16) -> anyhow::Result<()> {
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

// wait_load enables the Page domain and blocks until loadEventFired.
// One connection, events skipped except the one waited on.
fn wait_load(ws_url: &str) -> anyhow::Result<()> {
    let (mut sock, _) = tungstenite::connect(ws_url)?;
    sock.send(tungstenite::Message::Text(
        r#"{"id":1,"method":"Page.enable","params":{}}"#.into(),
    ))?;
    // Skip ack id 1 and any stray events until the load event lands.
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

fn cdp_call(ws_url: &str, id: i64, method: &str, params: &str) -> anyhow::Result<serde_json::Value> {
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
                // event for another call; skip
            }
            tungstenite::Message::Ping(p) => {
                sock.send(tungstenite::Message::Pong(p))?;
            }
            tungstenite::Message::Close(_) => anyhow::bail!("ws closed"),
            _ => {}
        }
    }
}

fn main() -> anyhow::Result<()> {
    let port = free_port();
    let mut child: Child = Command::new("/usr/bin/chromium")
        .args([
            "--headless=new",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-dev-shm-usage",
            &format!("--remote-debugging-port={port}"),
            "https://example.com/",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    wait_http(port)?;
    // Find the example.com page target.
    let mut ws_url = String::new();
    for _ in 0..50 {
        let list: serde_json::Value = serde_json::from_str(&http_get(port, "/json/list")?)?;
        if let Some(arr) = list.as_array() {
            for t in arr {
                let url = t.get("url").and_then(|u| u.as_str()).unwrap_or("");
                if url.contains("example.com") {
                    if let Some(ws) = t.get("webSocketDebuggerUrl").and_then(|w| w.as_str()) {
                        ws_url = ws.to_string();
                        break;
                    }
                }
            }
        }
        if !ws_url.is_empty() {
            break;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    if ws_url.is_empty() {
        anyhow::bail!("no example.com target");
    }
    wait_load(&ws_url)?;
    let res = cdp_call(
        &ws_url,
        1,
        "Runtime.evaluate",
        r#"{"expression":"document.title","returnByValue":true}"#,
    )?;
    let title = &res["result"]["result"]["value"];
    println!("title: {title}");
    child.kill()?;
    Ok(())
}
