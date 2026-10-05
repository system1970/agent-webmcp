// Codemode verbs: execute, search. Programs compose the session's
// tools; search discovers them progressively (Cloudflare's
// search/describe: pull definitions, never receive the catalog).
use crate::plugin::{Plugin, Verb};
use std::time::Duration;

fn flag(args: &[String], name: &str) -> Option<String> {
    let mut it = args.iter().peekable();
    while let Some(a) = it.next() {
        if a == name {
            return it.next().cloned();
        }
        if let Some(v) = a.strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
    }
    None
}

fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

/// Build the session catalog: live page tools plus verified custom
/// tools for the page host. Required args come from each tool's
/// input schema; loop/confirm tools are excluded (a program cannot
/// pause mid-run for a human).
fn build_catalog(ctx: &crate::plugin::Ctx, args: &[String], max: usize) -> anyhow::Result<crate::exec::Catalog> {
    use std::collections::HashMap;
    let session = ctx.session_for(args);
    let (port, _) = crate::session::load(&session)?;
    let ws = crate::session::session_target(&session, port)?;
    let mut leaves = HashMap::new();
    // Live page tools.
    for (tool, frame) in crate::webmcp::list_tools(&ws).unwrap_or_default() {
        let name = tool.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
        if name.is_empty() || leaves.contains_key(&name) {
            continue;
        }
        let desc = tool
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("")
            .to_string();
        let required: Vec<String> = tool
            .get("inputSchema")
            .and_then(|s| s.get("required"))
            .and_then(|r| r.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let frame = frame.clone();
        let ws = ws.clone();
        leaves.insert(
            name.clone(),
            crate::exec::Leaf {
                name: name.clone(),
                desc,
                required,
                run: Box::new(move |params| crate::webmcp::invoke_tool(&ws, &name, params, &frame)),
            },
        );
    }
    Ok(crate::exec::Catalog {
        leaves,
        calls: 0,
        max,
        deadline: std::time::Instant::now() + Duration::from_secs(120),
    })
}

/// Build the session catalog: live page tools plus verified custom
fn max_calls(args: &[String]) -> usize {
    flag(args, "--max-calls")
        .and_then(|s| s.parse().ok())
        .map(|n: i64| n.clamp(1, 50) as usize)
        .unwrap_or(10)
}

fn timeout_ms(args: &[String]) -> u64 {
    flag(args, "--timeout-ms")
        .and_then(|s| s.parse().ok())
        .unwrap_or(30_000)
}

/// Codemode verbs: execute, search.
pub fn plugins() -> Vec<Plugin> {
    vec![Plugin {
        id: "codemode.exec",
        permissions: vec![crate::plugin::Permission::Network],
        verbs: vec![
            Verb {
                name: "execute",
                help: "execute --program @file|<js> [--session NAME] [--max-calls N] — run one JS program over session tools",
                run: |ctx, _reg, args| {
                    let mut skip = false;
                    let positional: Vec<&String> = args
                        .iter()
                        .filter(|a| {
                            if skip {
                                skip = false;
                                return false;
                            }
                            if *a == "--session" || *a == "--max-calls" || *a == "--timeout-ms" || *a == "--program" {
                                skip = true;
                                return false;
                            }
                            !a.starts_with('-')
                        })
                        .collect();
                    let code = if has(args, "--program") {
                        flag(args, "--program").unwrap_or_default()
                    } else {
                        positional.first().map(|s| s.as_str()).unwrap_or_default().to_string()
                    };
                    let code = if let Some(path) = code.strip_prefix('@') {
                        std::fs::read_to_string(path)
                            .map_err(|e| anyhow::anyhow!("cannot read program {path}: {e}"))?
                    } else {
                        code
                    };
                    if code.trim().is_empty() {
                        anyhow::bail!("usage: execute --program @file|<js> [--session NAME] [--max-calls N]");
                    }
                    let max = max_calls(args);
                    let timeout = Duration::from_millis(timeout_ms(args));
                    let catalog = build_catalog(ctx, args, max)?;
                    let names = catalog.names();
                    let out = crate::exec::run_program(catalog, &code, timeout)?;
                    Ok(serde_json::json!({"result": out, "tools": names.len()}))
                },
            },
            Verb {
                name: "search",
                help: "search <terms> [--session NAME] [--limit N] [--offset N] — progressive discovery over session tools",
                run: |ctx, _reg, args| {
                    // Terms are positionals that are not flags or flag values.
                    let mut skip = false;
                    let query = args
                        .iter()
                        .filter(|a| {
                            if skip {
                                skip = false;
                                return false;
                            }
                            if *a == "--session" || *a == "--limit" || *a == "--offset" {
                                skip = true;
                                return false;
                            }
                            !a.starts_with('-')
                        })
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" ");
                    if query.trim().is_empty() {
                        anyhow::bail!("usage: search <terms> [--session NAME] [--limit N] [--offset N]");
                    }
                    let limit = flag(args, "--limit")
                        .and_then(|s| s.parse().ok())
                        .map(|n: usize| n.clamp(1, 50))
                        .unwrap_or(10);
                    let offset = flag(args, "--offset")
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0);
                    let catalog = build_catalog(ctx, args, 10)?;
                    let (results, total) = catalog.search(&query, limit, offset);
                    Ok(serde_json::json!({"results": results, "total": total}))
                },
            },
        ],
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    }]
}
