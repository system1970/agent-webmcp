use clap::{Parser, Subcommand};

mod cdp;
mod plugin;

use plugin::{Ctx, Permission, Plugin, Registry, Verb};

fn boot_registry() -> Registry {
    let mut r = Registry::new(vec![]);
    // core.policy: untrusted-page-data rules live here so no repo can
    // switch them off (enabled() ignores removals for core.*).
    r.register(Plugin {
        id: "core.policy",
        permissions: vec![],
        verbs: vec![],
        hooks: plugin::Hooks {
            before: None,
            after: Some(|_ctx, _verb, _args, out| {
                // Receipts carry an untrusted marker on page-derived data.
                // Today: no-op guard proving the hook path runs.
                let _ = out;
                Ok(())
            }),
        },
    });
    r.register(Plugin {
        id: "core.receipts",
        permissions: vec![],
        verbs: vec![],
        hooks: plugin::Hooks {
            before: None,
            after: None,
        },
    });
    r.register(Plugin {
        id: "core.version",
        permissions: vec![],
        verbs: vec![Verb {
            name: "version",
            help: "print version",
            run: |_ctx, _args| Ok(serde_json::json!({"version": env!("CARGO_PKG_VERSION")})),
        }],
        hooks: plugin::Hooks {
            before: None,
            after: None,
        },
    });
    r.register(Plugin {
        id: "core.plugin",
        permissions: vec![],
        verbs: vec![Verb {
            name: "plugin",
            help: "plugin <list> — show registered plugins and state",
            run: |ctx, args| {
                let _ = ctx;
                match args.first().map(|s| s.as_str()) {
                    Some("list") => Ok(serde_json::json!({"plugins": REG.list()})),
                    _ => anyhow::bail!("usage: plugin <list>"),
                }
            },
        }],
        hooks: plugin::Hooks {
            before: None,
            after: None,
        },
    });
    r.register(Plugin {
        id: "browser.open",
        permissions: vec![Permission::Spawn, Permission::Network],
        verbs: vec![Verb {
            name: "open",
            help: "open <url> — launch headless Chromium, navigate, wait load",
            run: |ctx, args| {
                let _ = ctx;
                let url = args.first().map(|s| s.as_str()).unwrap_or("about:blank");
                let port = cdp::free_port();
                let child = cdp::launch_chrome(port)?;
                cdp::wait_http(port)?;
                let ws = cdp::first_page(port)?;
                cdp::call(&ws, 1, "Page.navigate", &format!(r#"{{"url":{url:?}}}"#))?;
                // Same page target after navigate; wait load on it.
                cdp::wait_load(&ws)?;
                // The browser outlives the verb (sessions bind later);
                // The browser outlives the verb (sessions bind later);
                // the spike leaks the handle: the browser keeps running.
                std::mem::forget(child);
                Ok(serde_json::json!({"url": url, "port": port}))
            },
        }],
        hooks: plugin::Hooks {
            before: None,
            after: None,
        },
    });
    r
}

// The registry is process-global: verbs look it up for `plugin list`.
static REG: std::sync::LazyLock<Registry> = std::sync::LazyLock::new(boot_registry);

#[derive(Parser)]
#[command(name = "agent-webmcp", version, about = "minimal WebMCP bridge for any harness")]
struct Cli {
    #[command(subcommand)]
    verb: Verbs,
}

#[derive(Subcommand)]
enum Verbs {
    /// run a verb by name (verbs are plugins; this is the dispatcher)
    #[command(external_subcommand)]
    Other(Vec<String>),
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let ctx = Ctx {
        session: std::env::var("AGENT_WEBMCP_SESSION").unwrap_or("default".into()),
        profile: std::env::var("AGENT_WEBMCP_PROFILE").unwrap_or("shared".into()),
        json: true,
    };
    let Verbs::Other(mut words) = cli.verb;
    if words.is_empty() {
        anyhow::bail!("usage: agent-webmcp <verb> [args]");
    }
    let name = words.remove(0);
    let rest = words;
    let reg = &*REG;
    let (_, v) = reg.verb(&name).ok_or_else(|| anyhow::anyhow!("unknown verb {name}"))?;
    reg.hooks_before(&ctx, &name, &rest)?;
    let out = (v.run)(&ctx, &rest)?;
    reg.hooks_after(&ctx, &name, &rest, &out)?;
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}
