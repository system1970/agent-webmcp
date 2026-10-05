// Sessions: name -> browser port + url. Files under
// ~/.agent-webmcp/rust/<session>/. The browser outlives verbs;
// sessions rebind across invocations.
use std::path::PathBuf;

fn dir(session: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or("/tmp".into());
    PathBuf::from(home)
        .join(".agent-webmcp/rust")
        .join(session)
}

pub fn save(session: &str, port: u16, url: &str) -> anyhow::Result<()> {
    let d = dir(session);
    std::fs::create_dir_all(&d)?;
    std::fs::write(d.join("port"), port.to_string())?;
    std::fs::write(d.join("url"), url)?;
    Ok(())
}

pub fn load(session: &str) -> anyhow::Result<(u16, String)> {
    let d = dir(session);
    let port: u16 = std::fs::read_to_string(d.join("port"))?
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("bad port file for session {session}"))?;
    let url = std::fs::read_to_string(d.join("url")).unwrap_or_default();
    // Liveness: the browser must answer.
    crate::cdp::wait_http(port).map_err(|_| anyhow::anyhow!("no_browser: session {session} has no live browser"))?;
    Ok((port, url.trim().to_string()))
}
