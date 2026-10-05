// MCP stdio server: newline-delimited JSON-RPC 2.0 on stdin/stdout.
// Stdout is protocol only; logs go to stderr. Verbs become MCP tools
// through the same registry the CLI dispatches, so the surfaces cannot
// drift: one registry, two transports.
//
// Minimal surface: initialize, tools/list, tools/call. Everything else
// is method-not-found. Page results keep untrusted:true end to end.
use std::io::{BufRead, Write};

use crate::plugin::{Ctx, Registry};

/// Run the stdio loop. Blocks until stdin closes.
pub fn serve(reg: &Registry, ctx: &Ctx) -> anyhow::Result<()> {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let resp = handle(reg, ctx, &line);
        writeln!(out, "{}", resp)?;
        out.flush()?;
    }
    Ok(())
}

fn handle(reg: &Registry, ctx: &Ctx, line: &str) -> String {
    let req: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => {
            return rpc_error(None, -32700, "parse error");
        }
    };
    let id = req.get("id").cloned().unwrap_or(serde_json::Value::Null);
    let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = req.get("params").cloned().unwrap_or(serde_json::json!({}));
    match method {
        "initialize" => rpc_ok(
            id,
            serde_json::json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "agent-webmcp", "version": env!("CARGO_PKG_VERSION")},
            }),
        ),
        "notifications/initialized" => return String::new(),
        "tools/list" => {
            let mut tools = vec![];
            for p in &reg.plugins_for_list() {
                for v in &p.verbs {
                    tools.push(serde_json::json!({
                        "name": format!("agent_webmcp_{}", v.name),
                        "description": v.help,
                        "inputSchema": {"type": "object"},
                    }));
                }
            }
            rpc_ok(id, serde_json::json!({"tools": tools}))
        }
        "tools/call" => {
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let verb = name.strip_prefix("agent_webmcp_").unwrap_or(name);
            let args = params
                .get("arguments")
                .and_then(|a| a.as_object())
                .map(|m| {
                    m.iter()
                        .flat_map(|(k, v)| {
                            // Booleans are bare flags (true) or omitted (false);
                            // everything else is --key value.
                            if v.as_bool() == Some(true) {
                                vec![format!("--{k}")]
                            } else if v.as_bool() == Some(false) || v.is_null() {
                                vec![]
                            } else if v.is_string() {
                                vec![format!("--{k}"), v.as_str().unwrap_or("").to_string()]
                            } else {
                                vec![format!("--{k}"), v.to_string()]
                            }
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            match reg.verb(verb) {
                Some((_, v)) => {
                    if let Err(e) = reg.hooks_before(ctx, verb, &args) {
                        return rpc_error(
                            Some(id),
                            -32000,
                            &format!("hook veto: {e:#}"),
                        );
                    }
                    match (v.run)(ctx, reg, &args) {
                        Ok(val) => {
                            let _ = reg.hooks_after(ctx, verb, &args, &val);
                            rpc_ok(
                                id,
                                serde_json::json!({"content": [{"type": "text", "text": val.to_string()}]}),
                            )
                        }
                        Err(e) => rpc_error(Some(id), -32000, &format!("{e:#}")),
                    }
                }
                None => rpc_error(Some(id), -32601, &format!("unknown verb {verb}")),
            }
        }
        _ => rpc_error(Some(id), -32601, &format!("method not found: {method}")),
    }
}

fn rpc_ok(id: serde_json::Value, result: serde_json::Value) -> String {
    serde_json::json!({"jsonrpc": "2.0", "id": id, "result": result}).to_string()
}

fn rpc_error(id: Option<serde_json::Value>, code: i64, msg: &str) -> String {
    serde_json::json!({"jsonrpc": "2.0", "id": id.unwrap_or(serde_json::Value::Null), "error": {"code": code, "message": msg}}).to_string()
}
