// Custom tools: page JS that registers WebMCP tools through the
// page's own document.modelContext, exactly like a site-native tool.
// Registry: ~/.agent-webmcp/tools/<name>.js + <name>.json.
// Only verified tools auto-inject on open; unverified need `tools load`.
use std::path::PathBuf;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToolMeta {
    pub name: String,
    pub hosts: Vec<String>,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub verified_at: String,
}

pub fn root() -> PathBuf {
    crate::session::home().join(".agent-webmcp/tools")
}

fn slug(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Load all registry entries. Skips unreadable files; a tool without a
/// JS file is skipped (loop-backed tools live in a later section).
pub fn load_all() -> Vec<ToolMeta> {
    let mut out = vec![];
    let entries = match std::fs::read_dir(root()) {
        Ok(e) => e,
        Err(_) => return out,
    };
    for e in entries.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        let b = match std::fs::read(&p) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let m: ToolMeta = match serde_json::from_slice(&b) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if m.name.is_empty() || m.file.is_empty() {
            continue;
        }
        out.push(m);
    }
    out
}

/// Host match: exact, *.suffix, or *.
pub fn host_match(host: &str, patterns: &[String]) -> bool {
    let host = host.to_lowercase();
    for p in patterns {
        let p = p.to_lowercase();
        if p == "*" || p == host {
            return true;
        }
        if let Some(suf) = p.strip_prefix("*.")
            && (host == suf || host.ends_with(&format!(".{suf}"))) {
                return true;
            }
    }
    false
}

pub fn for_host(host: &str) -> Vec<ToolMeta> {
    load_all()
        .into_iter()
        .filter(|m| host_match(host, &m.hosts))
        .collect()
}

pub fn save_meta(m: &ToolMeta) -> anyhow::Result<()> {
    std::fs::create_dir_all(root())?;
    let path = root().join(format!("{}.json", slug(&m.name)));
    std::fs::write(path, serde_json::to_string_pretty(m)?)?;
    Ok(())
}

pub fn save_file(name: &str, js: &str) -> anyhow::Result<String> {
    std::fs::create_dir_all(root())?;
    let file = format!("{}.js", slug(name));
    std::fs::write(root().join(&file), js)?;
    Ok(file)
}

/// Inject a tool file into the page: evaluate it, learn registered
/// names from `ok:<tool>` lines. Returns the registered names.
pub fn inject(ws: &str, js: &str) -> anyhow::Result<Vec<String>> {
    let params = serde_json::json!({"expression": js, "returnByValue": true}).to_string();
    let res = crate::cdp::call(ws, 1, "Runtime.evaluate", &params)?;
    let text = res["result"]["result"]["value"]
        .as_str()
        .unwrap_or("")
        .to_string();
    // The file prints ok:<tool> per registered tool; anything else is log noise.
    let mut names = vec![];
    for line in text.lines() {
        if let Some(n) = line.strip_prefix("ok:") {
            let n = n.trim().to_string();
            if !n.is_empty() {
                names.push(n);
            }
        }
    }
    Ok(names)
}

/// Inject verified host-matched tools after navigation. Best-effort:
///
/// an injection failure never fails the open.
pub fn inject_verified(ws: &str, host: &str) -> Vec<String> {
    let mut injected = vec![];
    for m in for_host(host).iter().filter(|m| m.verified) {
        let js = match std::fs::read_to_string(root().join(&m.file)) {
            Ok(js) => js,
            Err(_) => continue,
        };
        match inject(ws, &js) {
            Ok(names) => injected.extend(names),
            Err(_) => continue,
        }
    }
    injected
}
