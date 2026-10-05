// Core verbs: version, plugin. Policy plugins (core.policy,
// core.receipts) carry hooks with no verbs: they can never be
// switched off and they shape every call.
use crate::plugin::{Plugin, Verb};

/// Core verbs and policy hooks.
pub fn plugins() -> Vec<Plugin> {
    vec![
        Plugin {
            id: "core.policy",
            permissions: vec![],
            verbs: vec![],
            hooks: crate::plugin::Hooks {
                before: None,
                // Receipts carry an untrusted marker on page-derived data.
                // Today: no-op guard proving the hook path runs.
                after: Some(|_ctx, _verb, _args, out| {
                    let _ = out;
                    Ok(())
                }),
            },
        },
        Plugin {
            id: "core.receipts",
            permissions: vec![],
            verbs: vec![],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
        Plugin {
            id: "core.version",
            permissions: vec![],
            verbs: vec![Verb {
                name: "version",
                help: "print version",
                run: |_ctx, _reg, _args| Ok(serde_json::json!({"version": env!("CARGO_PKG_VERSION")})),
            }],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
        Plugin {
            id: "core.plugin",
            permissions: vec![],
            verbs: vec![Verb {
                name: "plugin",
                help: "plugin <list> — show registered plugins and state",
                run: |_ctx, reg, args| match args.first().map(|s| s.as_str()) {
                    Some("list") => Ok(reg.list()),
                    _ => anyhow::bail!("usage: plugin <list>"),
                },
            },
            Verb {
                name: "audit",
                help: "audit — verb usage, error rate, mean ms from the evidence log",
                run: |_ctx, _reg, _args| Ok(crate::session::audit_all()),
            }],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
        Plugin {
            id: "core.mcp",
            permissions: vec![crate::plugin::Permission::Network],
            verbs: vec![Verb {
                name: "mcp",
                help: "mcp — serve verbs over MCP stdio (JSON-RPC 2.0)",
                run: |ctx, reg, _args| {
                    crate::mcp::serve(reg, ctx)?;
                    Ok(serde_json::json!({"closed": true}))
                },
            }],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
    ]
}
