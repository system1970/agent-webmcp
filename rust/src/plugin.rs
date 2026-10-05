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

/// What a plugin may touch. Requested in the manifest, enforced by the host.
// Unused variants are future backends (secrets managers, fs tools).
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
/// Handlers receive the call context, the registry (so verbs like
/// `plugin list` can describe the system), and raw args.
pub struct Verb {
    pub name: &'static str,
    pub help: &'static str,
    pub run: fn(&Ctx, &Registry, &[String]) -> anyhow::Result<serde_json::Value>,
}

/// Hooks run around verbs. `before` may veto by returning Err.
pub struct Hooks {
    pub before: Option<fn(&Ctx, &str, &[String]) -> anyhow::Result<()>>,
    pub after: Option<fn(&Ctx, &str, &[String], &serde_json::Value) -> anyhow::Result<()>>,
}

/// Host context handed to every verb: session, profile, output mode.
/// `json` reserves machine-vs-human output for future human-readable
/// verbs; today every verb emits JSON.
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

    pub fn list(&self) -> serde_json::Value {
        let plugins: Vec<serde_json::Value> = self
            .plugins
            .iter()
            .map(|p| {
                serde_json::json!({
                    "id": p.id,
                    "enabled": self.enabled(p.id),
                    "permissions": p.permissions.iter().map(|perm| format!("{perm:?}").to_lowercase()).collect::<Vec<_>>(),
                    "verbs": p.verbs.iter().map(|v| serde_json::json!({"name": v.name, "help": v.help})).collect::<Vec<_>>(),
                })
            })
            .collect();
        serde_json::json!({"plugins": plugins})
    }
}
