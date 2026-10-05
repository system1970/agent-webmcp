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
        fail_runtime(&format!("policy_denied: {e:#}"));
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
            fail_runtime(&format!("{e:#}"))
        }
    };
    let ms = start.elapsed().as_millis() as u64;
    if let Err(e) = reg.hooks_after(&ctx, &name, &words, &out) {
        fail_runtime(&format!("policy_denied: {e:#}"));
    }
    // Evidence log: every call appends one JSONL row (verb, ms, ok).
    // The audit verb reads this back: usage, error rate, dead verbs.
    // HarnessTax rule: measure what actually fires; cut what doesn't.
    // Success logs under the same session failures use (the verb may
    // override it via --session; the env default would misattribute).
    crate::session::log_call(&logged_session, &name, ms, true);
    // mcp owns stdout end to end (JSON-RPC lines); a trailing verb
    // envelope would break strict line-parsers at shutdown.
    if name == "mcp" {
        return;
    }
    // Arcjet rule: pretty for humans (TTY), compact for machines.
    if std::io::IsTerminal::is_terminal(&std::io::stdout()) {
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
    } else {
        println!("{}", serde_json::to_string(&out).unwrap());
    }
}

/// fail prints a bad_verb envelope and exits 2: dispatch failures
/// (no verb, unknown verb) fail hard, never fuzzy.
fn fail(msg: &str) -> ! {
    println!(
        "{}",
        serde_json::json!({"ok": false, "code": "bad_verb", "error": msg})
    );
    std::process::exit(2);
}

/// Codes agents retry by. The leading `word:` of a message selects the
/// code; anything unrecognized is tool_failed (undifferentiated infra
/// failure: diagnose, don't blindly retry).
const KNOWN_CODES: &[&str] = &[
    "usage",
    "no_browser",
    "no_session",
    "no_tab",
    "not_found",
    "need_frame",
    "stale_target",
    "resolve_failed",
    "fill_failed",
    "verify_failed",
    "eval_failed",
    "canceled",
    "timeout",
    "budget",
    "tool_error",
    "policy_denied",
    "exists",
    "bad_verb",
];

fn code_of(msg: &str) -> &str {
    let head = msg.split(':').next().unwrap_or("");
    if !head.is_empty()
        && head.chars().all(|c| c.is_ascii_lowercase() || c == '_')
        && KNOWN_CODES.contains(&head)
    {
        head
    } else {
        "tool_failed"
    }
}

/// fail_runtime prints an honest-code envelope and exits 1: the verb
/// dispatched fine but the call failed. Exit 2 stays reserved for
/// dispatch failures so harnesses can separate them.
fn fail_runtime(msg: &str) -> ! {
    println!(
        "{}",
        serde_json::json!({"ok": false, "code": code_of(msg), "error": msg})
    );
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_derive() {
        assert_eq!(code_of("no_browser: session x has no live browser"), "no_browser");
        assert_eq!(code_of("usage: click <@eN>"), "usage");
        assert_eq!(code_of("policy_denied: hook"), "policy_denied");
        assert_eq!(code_of("timeout: no tool response within budget"), "timeout");
        assert_eq!(code_of("budget: max_calls exceeded (10)"), "budget");
        assert_eq!(code_of("tool_error: unknown tool x"), "tool_error");
        assert_eq!(code_of("ws closed"), "tool_failed");
        assert_eq!(code_of("cdp invokeTool: reply timeout"), "tool_failed");
        assert_eq!(code_of("js: boom"), "tool_failed");
        assert_eq!(code_of(""), "tool_failed");
    }

    #[test]
    fn version_carries_rev() {
        let reg = boot_registry();
        let (_, v) = reg.verb("version").expect("version verb");
        let out = (v.run)(
            &crate::plugin::Ctx {
                session: "default".into(),
                profile: "shared".into(),
                json: true,
            },
            &reg,
            "version",
            &[],
        )
        .expect("version runs");
        assert_eq!(out["version"], serde_json::json!(env!("CARGO_PKG_VERSION")));
        assert!(out["rev"].as_str().is_some_and(|r| !r.is_empty()));
    }
}
