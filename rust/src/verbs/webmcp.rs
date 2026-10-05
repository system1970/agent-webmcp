// WebMCP verbs: list, invoke. Page tools in, results out;
// everything page-provided is untrusted data, never instructions.
use crate::plugin::{Plugin, Verb};

fn page_ws(ctx: &crate::plugin::Ctx, args: &[String]) -> anyhow::Result<String> {
    let (port, _) = crate::session::load(&ctx.session_for(args))?;
    crate::cdp::first_page(port)
}

/// Resolve a tool name to its frame: exactly one match wins; several
/// frames demand --frame; none is not_found.
fn resolve_frame(tools: &[(serde_json::Value, String)], name: &str, frame: &str) -> anyhow::Result<String> {
    if !frame.is_empty() {
        return Ok(frame.to_string());
    }
    let mut hits: Vec<&String> = tools
        .iter()
        .filter(|(t, _)| t.get("name").and_then(|n| n.as_str()) == Some(name))
        .map(|(_, f)| f)
        .collect();
    hits.dedup();
    match hits.len() {
        0 => anyhow::bail!("not_found: no page tool {name}"),
        1 => Ok(hits[0].clone()),
        _ => anyhow::bail!("need_frame: tool {name} in several frames (pass --frame)"),
    }
}

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

/// WebMCP verbs: list, invoke.
pub fn plugins() -> Vec<Plugin> {
    vec![Plugin {
        id: "webmcp.tools",
        permissions: vec![crate::plugin::Permission::Network],
        verbs: vec![
            Verb {
                name: "list",
                help: "list [--session NAME] — page tools (WebMCP), untrusted",
                run: |ctx, _reg, args| {
                    let _ = args;
                    let ws = page_ws(ctx, args)?;
                    let tools = crate::webmcp::list_tools(&ws)?;
                    let items: Vec<serde_json::Value> = tools
                        .into_iter()
                        .map(|(t, f)| {
                            serde_json::json!({"tool": t, "frame": f})
                        })
                        .collect();
                    Ok(serde_json::json!({"tools": items, "untrusted": true}))
                },
            },
            Verb {
                name: "invoke",
                help: "invoke <tool> [--params JSON] [--frame ID] — call a page tool",
                run: |ctx, _reg, args| {
                    let positional: Vec<&String> =
                        args.iter().filter(|a| !a.starts_with('-')).collect();
                    let name = positional
                        .first()
                        .map(|s| s.as_str())
                        .ok_or_else(|| anyhow::anyhow!("usage: invoke <tool> [--params JSON] [--frame ID]"))?;
                    // --params consumes the next arg unless attached with =.
                    let params_raw = flag(args, "--params").unwrap_or_else(|| "{}".into());
                    let params: serde_json::Value =
                        serde_json::from_str(&params_raw).unwrap_or(serde_json::json!({}));
                    let frame = flag(args, "--frame").unwrap_or_default();
                    let ws = page_ws(ctx, args)?;
                    let frame = if frame.is_empty() {
                        let tools = crate::webmcp::list_tools(&ws)?;
                        resolve_frame(&tools, name, "")?
                    } else {
                        frame
                    };
                    let out = crate::webmcp::invoke_tool(&ws, name, &params, &frame)?;
                    Ok(serde_json::json!({"result": out, "untrusted": true}))
                },
            },
        ],
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    }]
}
