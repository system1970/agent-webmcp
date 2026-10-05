// Plugin system: everything is a plugin.
//
// A plugin contributes verbs, tools, hooks, or config. Internal plugins
// are compiled in (each verb file registers itself); external plugins
// are manifests pointing at executables (WASM later). The registry owns
// enable/disable with opencode-style control syntax:
//
//   plugins = ["*", "-browser.lightpanda", "auth.bitwarden"]
//
// A later ID re-enables; `-plugin.*` disables a namespace. Two builtins
// ignore removals so policy can never be switched off: `core.policy`
// (untrusted-page-data rules) and `core.receipts` (every action leaves
// a receipt).
use std::collections::HashMap;

/// What a plugin may touch. Requested in the manifest, enforced by the host.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum Permission {
    Browser,
    Network,
    Secrets,
    Fs,
    Spawn,
}

/// A verb a plugin contributes: name, one-line help, handler.
#[allow(dead_code)]
pub struct Verb {
    pub name: &'static str,
    pub help: &'static str,
    pub run: fn(&Ctx, &[String]) -> anyhow::Result<serde_json::Value>,
}

/// Hooks run around verbs. `before` may veto by returning Err.
pub struct Hooks {
    pub before: Option<fn(&Ctx, &str, &[String]) -> anyhow::Result<()>>,
    pub after: Option<fn(&Ctx, &str, &[String], &serde_json::Value) -> anyhow::Result<()>>,
}

/// Host context handed to every verb: session, profile, output mode.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Ctx {
    pub session: String,
    pub profile: String,
    pub json: bool,
}

/// A plugin: id, permissions it needs, verbs and hooks it contributes.
pub struct Plugin {
    pub id: &'static str,
    pub permissions: Vec<Permission>,
    pub verbs: Vec<Verb>,
    pub hooks: Hooks,
}

/// Registry: all compiled-in plugins plus the enable/disable control list.
pub struct Registry {
    plugins: Vec<Plugin>,
    control: Vec<String>,
}

impl Registry {
    pub fn new(control: Vec<String>) -> Self {
        Self {
            plugins: Vec::new(),
            control,
        }
    }

    pub fn register(&mut self, p: Plugin) {
        self.plugins.push(p);
    }

    /// opencode control semantics: "*" enables all, "-id" disables,
    /// "-ns.*" disables a namespace, a later ID re-enables. Evaluated
    /// in order; unset means enabled unless "*" never appeared... here
    /// the default is enabled (CLI ships working), control only removes.
    pub fn enabled(&self, id: &str) -> bool {
        if id == "core.policy" || id == "core.receipts" {
            return true; // policy plugins ignore removals
        }
        let mut on = true;
        for c in &self.control {
            if *c == "*" {
                on = true;
            } else if c.strip_prefix('-').map(|s| s == id).unwrap_or(false) {
                on = false;
            } else if let Some(ns) = c.strip_prefix('-').and_then(|s| s.strip_suffix(".*")) {
                if id == ns || id.starts_with(&format!("{ns}.")) {
                    on = false;
                }
            } else if *c == id {
                on = true;
            }
        }
        on
    }

    pub fn verb(&self, name: &str) -> Option<(&Plugin, &Verb)> {
        for p in &self.plugins {
            if !self.enabled(p.id) {
                continue;
            }
            for v in &p.verbs {
                if v.name == name {
                    return Some((p, v));
                }
            }
        }
        None
    }

    pub fn hooks_before(&self, ctx: &Ctx, verb: &str, args: &[String]) -> anyhow::Result<()> {
        for p in &self.plugins {
            if !self.enabled(p.id) {
                continue;
            }
            if let Some(f) = p.hooks.before {
                f(ctx, verb, args)?;
            }
        }
        Ok(())
    }

    pub fn hooks_after(
        &self,
        ctx: &Ctx,
        verb: &str,
        args: &[String],
        out: &serde_json::Value,
    ) -> anyhow::Result<()> {
        for p in &self.plugins {
            if !self.enabled(p.id) {
                continue;
            }
            if let Some(f) = p.hooks.after {
                f(ctx, verb, args, out)?;
            }
        }
        Ok(())
    }

    pub fn list(&self) -> Vec<HashMap<&str, String>> {
        self.plugins
            .iter()
            .map(|p| {
                let mut m = HashMap::new();
                m.insert("id", p.id.to_string());
                m.insert(
                    "enabled",
                    if self.enabled(p.id) {
                        "true".into()
                    } else {
                        "false".into()
                    },
                );
                m.insert(
                    "verbs",
                    p.verbs.iter().map(|v| v.name).collect::<Vec<_>>().join(","),
                );
                m
            })
            .collect()
    }
}
