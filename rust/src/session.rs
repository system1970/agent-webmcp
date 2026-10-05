// Sessions and profiles. The model mirrors agent-browser's:
// named sessions, one stable id reused across commands; profiles own
// browsers (one profile = one browser = one cookie jar); sessions bind
// to tabs by target id and reattach across invocations.
//
// Layout:
//   ~/.agent-webmcp/rust/profiles/<profile>/port   — live browser port
//   ~/.agent-webmcp/rust/<session>/target          — profile + target id
//   ~/.agent-webmcp/rust/<session>/url             — last url (diagnostics)
//
// Rules:
// - open reuses the profile's live browser; it launches only when none
//   answers. No verb ever launches a browser per call.
// - each session gets its own tab (Target.createTarget); later verbs
//   attach to the bound tab. A closed tab binds a fresh one; verbs
//   never act on another session's tab silently.
// - close shuts the session tab; close --all kills profile browsers.
use std::path::PathBuf;

fn base() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or("/tmp".into());
    PathBuf::from(home).join(".agent-webmcp/rust")
}

fn session_dir(session: &str) -> PathBuf {
    base().join(session)
}

fn profile_dir(profile: &str) -> PathBuf {
    base().join("profiles").join(profile)
}

/// Ensure the profile browser: reuse the live one, else launch.
/// A headed/headless mismatch relaunches: a reused browser in the
/// wrong mode is a lie the receipt must never tell.
pub fn ensure_browser(profile: &str, headed: bool) -> anyhow::Result<(u16, bool)> {
    let d = profile_dir(profile);
    std::fs::create_dir_all(&d)?;
    if let Ok(port) = std::fs::read_to_string(d.join("port")) {
        if let Ok(port) = port.trim().parse::<u16>() {
            // Liveness: one cheap HTTP probe, not a wait loop.
            if crate::cdp::http_up(port) {
                let was_headed = std::fs::read_to_string(d.join("headed"))
                    .map(|h| h.trim() == "1")
                    .unwrap_or(false);
                if was_headed == headed {
                    return Ok((port, true));
                }
                kill_profile(profile);
            }
        }
    }
    let port = crate::cdp::free_port();
    let child = crate::cdp::launch_chrome(port, headed, profile)?;
    crate::cdp::wait_http(port)?;
    std::fs::write(d.join("port"), port.to_string())?;
    std::fs::write(d.join("pid"), child.id().to_string())?;
    std::fs::write(d.join("headed"), if headed { "1" } else { "0" })?;
    std::mem::forget(child); // the browser outlives verbs
    Ok((port, false))
}

/// Resolve the session's tab: bound target if alive, else a fresh tab
/// (created + bound). Returns the target's debugger URL.
pub fn session_target(session: &str, port: u16) -> anyhow::Result<String> {
    let d = session_dir(session);
    std::fs::create_dir_all(&d)?;
    if let Ok(bound) = std::fs::read_to_string(d.join("target")) {
        let bound = bound.trim().to_string();
        if !bound.is_empty() {
            let list: serde_json::Value =
                serde_json::from_str(&crate::cdp::http_get(port, "/json/list")?)?;
            if let Some(arr) = list.as_array() {
                for t in arr {
                    let id = t.get("id").and_then(|i| i.as_str()).unwrap_or("");
                    let is_page = t.get("type").and_then(|k| k.as_str()) == Some("page");
                    if is_page && id == bound {
                        if let Some(ws) = t.get("webSocketDebuggerUrl").and_then(|w| w.as_str()) {
                            if !ws.is_empty() {
                                return Ok(ws.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    // No live binding: fresh tab via Target.createTarget on the browser target.
    let browser_ws = crate::cdp::browser_ws(port)?;
    let res = crate::cdp::call(&browser_ws, 1, "Target.createTarget", r#"{"url":"about:blank"}"#)?;
    let id = res["result"]["targetId"].as_str().unwrap_or("").to_string();
    if id.is_empty() {
        anyhow::bail!("no_tab: could not create a tab");
    }
    std::fs::write(d.join("target"), &id)?;
    // The new target needs a moment to expose its debugger URL.
    for _ in 0..30 {
        let list: serde_json::Value =
            serde_json::from_str(&crate::cdp::http_get(port, "/json/list")?)?;
        if let Some(arr) = list.as_array() {
            for t in arr {
                if t.get("id").and_then(|i| i.as_str()) == Some(id.as_str()) {
                    if let Some(ws) = t.get("webSocketDebuggerUrl").and_then(|w| w.as_str()) {
                        if !ws.is_empty() {
                            return Ok(ws.to_string());
                        }
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    anyhow::bail!("no_tab: fresh tab never exposed a debugger url")
}

/// Kill one profile browser (tabs die; cookies persist for relaunch).
/// Uses the recorded pid; the port file goes regardless so a dead
/// browser never reads as live.
pub fn kill_profile(profile: &str) {
    let dir = profile_dir(profile);
    let pid = std::fs::read_to_string(dir.join("pid"))
        .ok()
        .and_then(|p| p.trim().parse::<u32>().ok());
    let _ = std::fs::remove_file(dir.join("port"));
    let _ = std::fs::remove_file(dir.join("pid"));
    let _ = std::fs::remove_file(dir.join("headed"));
    if let Some(pid) = pid {
        // Unix-only by design (Linux-first CLI): SIGKILL via kill(1).
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

/// Close one session tab via Target.closeTarget; clears the binding.
/// Returns true when a live tab was closed.
pub fn close_session(session: &str) -> bool {
    let d = session_dir(session);
    let target = std::fs::read_to_string(d.join("target"))
        .map(|t| t.trim().to_string())
        .unwrap_or_default();
    let _ = std::fs::remove_file(d.join("target"));
    if target.is_empty() {
        return false;
    }
    let port = std::fs::read_to_string(d.join("port"))
        .ok()
        .and_then(|p| p.trim().parse::<u16>().ok());
    match port {
        Some(p) => {
            let Ok(ws) = crate::cdp::browser_ws(p) else {
                return false;
            };
            crate::cdp::call(&ws, 1, "Target.closeTarget", &format!(r#"{{"targetId":{target:?}}}"#))
                .is_ok()
        }
        None => false,
    }
}

/// Kill every profile browser. Profiles (cookies) survive.
pub fn kill_all() -> Vec<String> {
    let mut killed = vec![];
    let base = base().join("profiles");
    let entries = match std::fs::read_dir(base) {
        Ok(e) => e,
        Err(_) => return killed,
    };
    for e in entries.flatten() {
        if !e.path().is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        kill_profile(&name);
        killed.push(name);
    }
    killed.sort();
    killed
}

/// Save session state: profile, port, url.
pub fn save(session: &str, profile: &str, port: u16, url: &str) -> anyhow::Result<()> {
    let d = session_dir(session);
    std::fs::create_dir_all(&d)?;
    std::fs::write(d.join("port"), port.to_string())?;
    std::fs::write(d.join("url"), url)?;
    std::fs::write(d.join("profile"), profile)?;
    Ok(())
}

/// Load session state with liveness check.
pub fn load(session: &str) -> anyhow::Result<(u16, String)> {
    let d = session_dir(session);
    let port: u16 = std::fs::read_to_string(d.join("port"))?
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("bad port file for session {session}"))?;
    let url = std::fs::read_to_string(d.join("url")).unwrap_or_default();
    if !crate::cdp::http_up(port) {
        anyhow::bail!("no_browser: session {session} has no live browser");
    }
    Ok((port, url.trim().to_string()))
}

/// All known sessions with liveness.
pub fn list_all() -> Vec<serde_json::Value> {
    let mut out = vec![];
    let entries = match std::fs::read_dir(base()) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name == "profiles" || !e.path().is_dir() {
            continue;
        }
        let port = std::fs::read_to_string(e.path().join("port"))
            .ok()
            .and_then(|p| p.trim().parse::<u16>().ok());
        let live = port.map(crate::cdp::http_up).unwrap_or(false);
        let url = std::fs::read_to_string(e.path().join("url"))
            .unwrap_or_default()
            .trim()
            .to_string();
        out.push(serde_json::json!({"session": name, "live": live, "url": url}));
    }
    out.sort_by(|a, b| a["session"].as_str().cmp(&b["session"].as_str()));
    out
}
