use clap::{Parser, Subcommand};

mod cdp;
mod exec;
mod mcp;
mod plugin;
mod session;
mod tools;
mod verbs;
mod webmcp;

use plugin::{Ctx, Registry};

/// Build the registry: all verb plugins plus the enable/disable
/// control list from AGENT_WEBMCP_PLUGINS (comma-separated, opencode
/// syntax: "*", "-id", "-ns.*", later IDs re-enable).
fn boot_registry() -> Registry {
    let control: Vec<String> = std::env::var("AGENT_WEBMCP_PLUGINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    let mut r = Registry::new(control);
    for p in verbs::all() {
        r.register(p);
    }
    r
}

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

fn main() {
    let cli = Cli::parse();
    let ctx = Ctx {
        session: std::env::var("AGENT_WEBMCP_SESSION").unwrap_or("default".into()),
        profile: std::env::var("AGENT_WEBMCP_PROFILE").unwrap_or("shared".into()),
        json: true,
    };
    let Verbs::Other(mut words) = cli.verb;
    if words.is_empty() {
        fail("usage: agent-webmcp <verb> [args]");
    }
    let name = words.remove(0);
    let reg = boot_registry();
    let (_, v) = match reg.verb(&name) {
        Some(found) => found,
        None => fail(&format!("unknown verb {name}")),
    };
    if let Err(e) = reg.hooks_before(&ctx, &name, &words) {
        fail(&format!("hook veto: {e:#}"));
    }
    let out = match (v.run)(&ctx, &reg, &words) {
        Ok(out) => out,
        Err(e) => fail(&format!("{e:#}")),
    };
    if let Err(e) = reg.hooks_after(&ctx, &name, &words, &out) {
        fail(&format!("hook veto: {e:#}"));
    }
    // Arcjet rule: pretty for humans (TTY), compact for machines.
    if std::io::IsTerminal::is_terminal(&std::io::stdout()) {
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        println!("{}", serde_json::to_string(&out).unwrap());
    }
}

/// fail prints a bad_verb-style envelope and exits 2: unknown verbs
/// fail hard, never fuzzy.
fn fail(msg: &str) -> ! {
    println!(
        "{}",
        serde_json::json!({"ok": false, "code": "bad_verb", "error": msg})
    );
    std::process::exit(2);
}
