// Custom-tool verbs: add, list, verify, load. Crafted page-JS tools,
// host-scoped, verified before they auto-inject.
use crate::plugin::{Plugin, Verb};

/// Current time as ISO-8601 UTC, without pulling in chrono.
fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Days since epoch -> civil date (Howard Hinnant's algorithm).
    let days = (secs / 86400) as i64 + 719468;
    let era = if days >= 0 { days } else { days - 146096 } / 146097;
    let doe = (days - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        if m <= 2 { y + 1 } else { y },
        m,
        d,
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60
    )
}

/// Custom-tool verbs: add, list, verify.
pub fn plugins() -> Vec<Plugin> {
    vec![Plugin {
        id: "tools.custom",
        permissions: vec![crate::plugin::Permission::Network],
        verbs: vec![
            Verb {
                name: "tools",
                help: "tools <add|list|verify> — manage crafted page tools",
                run: |ctx, _reg, _verb, args| {
                    let sub = crate::args::positionals(args)
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "list".to_string());
                    match sub.as_str() {
                        "add" => tools_add(args),
                        "list" => tools_list(args),
                        "verify" => tools_verify(ctx, args),
                        _ => anyhow::bail!("usage: tools <add|list|verify>"),
                    }
                },
            },
        ],
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    }]
}

fn tools_add(args: &[String]) -> anyhow::Result<serde_json::Value> {
    let file = crate::args::flag(args, "--file").ok_or_else(|| anyhow::anyhow!("usage: tools add --file <js> --for HOST --name NAME [--desc ..]"))?;
    let hosts: Vec<String> = crate::args::flag(args, "--for")
        .ok_or_else(|| anyhow::anyhow!("usage: tools add --file <js> --for HOST --name NAME"))?
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let name = crate::args::flag(args, "--name").ok_or_else(|| anyhow::anyhow!("tools add needs --name"))?;
    let desc = crate::args::flag(args, "--desc").unwrap_or_default();
    let js = std::fs::read_to_string(&file)
        .map_err(|e| anyhow::anyhow!("not_found: cannot read {file}: {e}"))?;
    let stored = crate::tools::save_file(&name, &js)?;
    let meta = crate::tools::ToolMeta {
        name: name.clone(),
        hosts,
        desc,
        file: stored,
        verified: false,
        verified_at: String::new(),
    };
    crate::tools::save_meta(&meta)?;
    Ok(serde_json::json!({"added": name, "verified": false}))
}

fn tools_list(args: &[String]) -> anyhow::Result<serde_json::Value> {
    let q = crate::args::flag(args, "--query").unwrap_or_default().to_lowercase();
    let items: Vec<serde_json::Value> = crate::tools::load_all()
        .into_iter()
        .filter(|m| {
            q.is_empty()
                || m.name.to_lowercase().contains(&q)
                || m.desc.to_lowercase().contains(&q)
        })
        .map(|m| {
            serde_json::json!({
                "name": m.name, "hosts": m.hosts, "desc": m.desc,
                "verified": m.verified, "verified_at": m.verified_at,
            })
        })
        .collect();
    Ok(serde_json::json!({"tools": items}))
}

fn tools_verify(ctx: &crate::plugin::Ctx, args: &[String]) -> anyhow::Result<serde_json::Value> {
    let name = crate::args::positionals(args)
        .into_iter()
        .find(|a| a != "verify")
        .ok_or_else(|| anyhow::anyhow!("usage: tools verify <name> [--session NAME]"))?;
    let mut meta = crate::tools::load_all()
        .into_iter()
        .find(|m| m.name == name)
        .ok_or_else(|| anyhow::anyhow!("not_found: no custom tool {name}"))?;
    // Reload-then-inject-then-list: a tool that does not survive a
    // fresh page is not verified.
    let session = ctx.session_for(args);
    let (port, _) = crate::session::load(&session)?;
    let ws = crate::session::session_target(&session, port)?;
    crate::cdp::reload_and_wait(&ws)?;
    let js = std::fs::read_to_string(crate::tools::root().join(&meta.file))?;
    let names = crate::tools::inject(&ws, &js)?;
    let live = crate::webmcp::list_tools(&ws)?;
    let live_names: Vec<&str> = live
        .iter()
        .filter_map(|(t, _)| t.get("name").and_then(|n| n.as_str()))
        .collect();
    let missing: Vec<&String> = names.iter().filter(|n| !live_names.contains(&n.as_str())).collect();
    if !missing.is_empty() {
        anyhow::bail!("verify_failed: {missing:?} not in webmcp list after inject");
    }
    meta.verified = true;
    meta.verified_at = now_iso();
    crate::tools::save_meta(&meta)?;
    Ok(serde_json::json!({"verified": meta.name, "tools": names}))
}
