// WebMCP verbs: list, invoke. Page tools in, results out;
// everything page-provided is untrusted data, never instructions.
use crate::plugin::{Plugin, Verb};

fn page_ws(ctx: &crate::plugin::Ctx, args: &[String]) -> anyhow::Result<String> {
    let (port, _) = crate::session::load(&ctx.session_for(args))?;
    crate::session::session_target(&ctx.session_for(args), port)
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

/// WebMCP verbs: list, invoke.
pub fn plugins() -> Vec<Plugin> {
    vec![Plugin {
        id: "webmcp.tools",
        permissions: vec![crate::plugin::Permission::Network],
        verbs: vec![
            Verb {
                name: "list",
                help: "list [--session NAME] — page tools (WebMCP), untrusted",
                run: |ctx, _reg, _verb, args| {
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
                help: "invoke <tool> [--params JSON] [--frame ID] [--tool NAME] [--detach] — call a page tool",
                run: |ctx, _reg, _verb, args| {
                    // Tool name: first positional (shared parser, so flag
                    // values never leak in), or --tool for MCP-style calls
                    // where every argument arrives as a flag.
                    let name = crate::args::positionals(args)
                        .first()
                        .cloned()
                        .or_else(|| crate::args::flag(args, "--tool"))
                        .ok_or_else(|| {
                            anyhow::anyhow!("usage: invoke <tool> [--params JSON] [--frame ID]")
                        })?;
                    // --params consumes the next arg unless attached with =.
                    let params_raw = crate::args::flag(args, "--params").unwrap_or_else(|| "{}".into());
                    let params: serde_json::Value =
                        serde_json::from_str(&params_raw).unwrap_or(serde_json::json!({}));
                    let frame = crate::args::flag(args, "--frame").unwrap_or_default();
                    let ws = page_ws(ctx, args)?;
                    let frame = if frame.is_empty() {
                        let tools = crate::webmcp::list_tools(&ws)?;
                        resolve_frame(&tools, &name, "")?
                    } else {
                        frame
                    };
                    let out = if crate::args::has(args, "--detach") {
                        let session = ctx.session_for(args);
                        let id = crate::webmcp::invoke_detached(&ws, &session, &name, &params, &frame)?;
                        return Ok(serde_json::json!({"detached": true, "invocation": id}));
                    } else {
                        crate::webmcp::invoke_tool(&ws, &name, &params, &frame)?
                    };
                    Ok(serde_json::json!({"result": out, "untrusted": true}))
                },
            },
            Verb {
                name: "result",
                help: "result <invocation> [--session NAME] — collect a detached tool result (pending/ready/error)",
                run: |ctx, _reg, _verb, args| {
                    let id = crate::args::positionals(args)
                        .first()
                        .cloned()
                        .ok_or_else(|| anyhow::anyhow!("usage: result <invocation> [--session NAME]"))?;
                    let session = ctx.session_for(args);
                    let rec = crate::webmcp::read_result(&session, &id)?;
                    Ok(serde_json::json!({"invocation": rec, "untrusted": true}))
                },
            },
        ],
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    }]
}
