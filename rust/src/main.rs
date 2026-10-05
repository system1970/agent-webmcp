use clap::{Parser, Subcommand};

mod args;
mod cdp;
mod exec;
mod ext;
mod mcp;
mod plugin;
mod session;
mod tools;
mod verbs;
mod webmcp;

use plugin::{Ctx, Registry};

/// Build the registry: all verb plugins plus the enable/disable
/// control list from AGENT_WEBMCP_PLUGINS (comma-separated, opencode
/// syntax: "*", "-id", "-ns.*", later IDs re-enable). External
/// manifest plugins load last; a broken manifest warns on stderr and
/// never fails the boot.
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
    ext::load_all(&mut r);
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
    // Session for evidence: verbs may override it, but the log needs a
    // name even when dispatch fails. Best-effort parse, same rules.
    let logged_session = crate::args::flag(&words, "--session")
        .or_else(|| crate::args::flag(&words, "-s"))
        .unwrap_or_else(|| ctx.session.clone());
    let reg = boot_registry();
    let (_, v) = match reg.verb(&name) {
        Some(found) => found,
        None => {
            crate::session::log_call(&logged_session, &name, 0, false);
            fail(&format!("unknown verb {name}"));
        }
    };
    if let Err(e) = reg.hooks_before(&ctx, &name, &words) {
        crate::session::log_call(&logged_session, &name, 0, false);
        fail(&format!("hook veto: {e:#}"));
    }
    let start = std::time::Instant::now();
    let out = match (v.run)(&ctx, &reg, &name, &words) {
        Ok(out) => out,
        Err(e) => {
            crate::session::log_call(
                &logged_session,
                &name,
                start.elapsed().as_millis() as u64,
                false,
            );
            fail(&format!("{e:#}"))
        }
    };
    let ms = start.elapsed().as_millis() as u64;
    if let Err(e) = reg.hooks_after(&ctx, &name, &words, &out) {
        fail(&format!("hook veto: {e:#}"));
    }
    // Evidence log: every call appends one JSONL row (verb, ms, ok).
    // The audit verb reads this back: usage, error rate, dead verbs.
    // HarnessTax rule: measure what actually fires; cut what doesn't.
    crate::session::log_call(&ctx.session, &name, ms, true);
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
