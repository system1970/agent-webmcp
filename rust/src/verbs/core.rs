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
                help: "version — print binary version",
                run: |_ctx, _reg, _verb, _args| {
                    Ok(serde_json::json!({
                        "version": env!("CARGO_PKG_VERSION"),
                        "rev": env!("AGENT_WEBMCP_REV"),
                    }))
                },
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
                help: "plugin <list|new|show|add|remove> — list, scaffold, show, install, uninstall",
                run: |_ctx, reg, _verb, args| match args.first().map(|s| s.as_str()) {
                    Some("list") => Ok(reg.list()),
                    Some("new") => {
                        let id = crate::args::positionals(args)
                            .into_iter()
                            .find(|a| a != "new")
                            .ok_or_else(|| anyhow::anyhow!("usage: plugin new <id> [--here]"))?;
                        crate::ext::scaffold(&id, crate::args::has(args, "--here"))
                    }
                    Some("show") => {
                        let id = crate::args::positionals(args)
                            .into_iter()
                            .find(|a| a != "show")
                            .ok_or_else(|| anyhow::anyhow!("usage: plugin show <id>"))?;
                        crate::ext::show(reg, &id)
                    }
                    Some("add") => {
                        let src = crate::args::positionals(args)
                            .into_iter()
                            .find(|a| a != "add")
                            .ok_or_else(|| anyhow::anyhow!("usage: plugin add <dir|git-url> [--here]"))?;
                        crate::ext::add(reg, &src, crate::args::has(args, "--here"))
                    }
                    Some("remove") => {
                        let id = crate::args::positionals(args)
                            .into_iter()
                            .find(|a| a != "remove")
                            .ok_or_else(|| anyhow::anyhow!("usage: plugin remove <id>"))?;
                        crate::ext::remove(&id)
                    }
                    _ => anyhow::bail!("usage: plugin <list|new|show|add|remove>"),
                },
            },
            Verb {
                name: "audit",
                help: "audit — verb usage, error rate, mean ms from the evidence log",
                run: |_ctx, _reg, _verb, _args| Ok(crate::session::audit_all()),
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
                run: |ctx, reg, _verb, _args| {
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
