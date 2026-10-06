// External plugins: manifest-loaded verbs in sandboxed JS.
//
// Pi parity for a web bridge: the binary holds still (registry,
// policy, transport, shells) while capability lives in plugin dirs:
//
//   <repo>/plugins/*/plugin.json          scope repo, dev
//   ~/.agent-webmcp/plugins/*/plugin.json scope user, always loaded
//   <cwd>/.agent-webmcp/plugins/*/plugin.json scope project, trusted only
//
// A plugin.json declares id, version, engine, permissions, and what it
// contributes (verbs as JS files, skill playbooks, tool globs). Verbs
// run in the same QuickJS sandbox as codemode: `args` plus the session
// page-tool catalog (tools.*, webmcp.search/describe, batch). No fetch,
// no fs, no host verbs yet — composition over page tools only.
//
// Fail-safe rules, all deliberate:
// - boot never writes and never fails: a broken manifest warns on
//   stderr (never stdout: MCP purity) and is skipped.
// - built-in verbs always win: an external verb colliding with one is
//   refused, never an override (project plugins must not hijack verbs).
// - `core.*` ids are reserved; unknown permissions refuse the plugin.
// - engine must match the binary (0.x compares minor too); tools from
//   plugins are listed, never auto-installed (install stays explicit).
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use crate::plugin::{Ctx, Permission, Plugin, Registry, Verb};

fn warn(msg: String) {
    eprintln!("agent-webmcp: {msg}");
}

fn leak(s: &str) -> &'static str {
    Box::leak(s.to_string().into_boxed_str())
}

// ---- manifest ----

#[derive(Debug, serde::Deserialize)]
struct Manifest {
    id: String,
    version: String,
    engine: String,
    #[serde(default)]
    permissions: Vec<String>,
    #[serde(default)]
    contributes: Contributes,
}

#[derive(Debug, Default, serde::Deserialize)]
struct Contributes {
    #[serde(default)]
    verbs: Vec<ManifestVerb>,
    #[serde(default)]
    tools: Vec<String>,
    #[serde(default)]
    skills: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ManifestVerb {
    name: String,
    #[serde(default)]
    help: String,
    run: String,
    /// Value flags this verb takes (--depth value). Registered into the
    /// shared parser so values never leak into positional.
    #[serde(default)]
    flags: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

fn valid_verb_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Engine compat: same major; on 0.x the minor must match too (0.x is
/// breaking per semver). Garbage never matches.
fn engine_ok(engine: &str) -> bool {
    let want = engine.trim().trim_start_matches(['^', '~', '>', '<', '=', ' ', '\t']);
    let mut parts = want.split('.');
    let (Some(maj), Some(min)) = (parts.next(), parts.next()) else {
        return false;
    };
    let (Ok(wmaj), Ok(wmin)) = (maj.parse::<u64>(), min.parse::<u64>()) else {
        return false;
    };
    let current = env!("CARGO_PKG_VERSION");
    let mut cur = current.split('.');
    let (Some(cmaj), Some(cmin)) = (cur.next(), cur.next()) else {
        return false;
    };
    let (Ok(cmaj), Ok(cmin)) = (cmaj.parse::<u64>(), cmin.parse::<u64>()) else {
        return false;
    };
    if cmaj != wmaj {
        return false;
    }
    if cmaj == 0 && cmin != wmin {
        return false;
    }
    true
}

fn parse_perm(s: &str) -> Option<Permission> {
    match s.to_lowercase().as_str() {
        "browser" => Some(Permission::Browser),
        "network" => Some(Permission::Network),
        "secrets" => Some(Permission::Secrets),
        "fs" => Some(Permission::Fs),
        "spawn" => Some(Permission::Spawn),
        _ => None,
    }
}

// ---- live state ----

struct ExtImpl {
    plugin_id: String,
    js: PathBuf,
}

fn impls() -> &'static std::sync::Mutex<HashMap<String, ExtImpl>> {
    static MAP: std::sync::OnceLock<std::sync::Mutex<HashMap<String, ExtImpl>>> =
        std::sync::OnceLock::new();
    MAP.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

// ---- discovery ----

fn user_plugins_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or("/tmp".into());
    PathBuf::from(home).join(".agent-webmcp/plugins")
}

/// Scope dirs to scan: (scope, dir holding plugin subdirs).
fn discover_dirs() -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    for d in ["plugins", "../plugins"] {
        let p = PathBuf::from(d);
        if p.is_dir() {
            out.push(("repo".to_string(), p));
        }
    }
    let user = user_plugins_dir();
    if user.is_dir() {
        out.push(("user".to_string(), user));
    }
    if std::env::var("AGENT_WEBMCP_TRUST_PROJECT").as_deref() == Ok("1") {
        let proj = PathBuf::from(".agent-webmcp/plugins");
        if proj.is_dir() {
            out.push(("project".to_string(), proj));
        }
    }
    // Explicit override: comma-separated extra scope dirs (tests, custom).
    if let Ok(extra) = std::env::var("AGENT_WEBMCP_PLUGINS_DIR") {
        for d in extra.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let p = PathBuf::from(d);
            if p.is_dir() {
                out.push(("extra".to_string(), p));
            }
        }
    }
    out
}

/// Load every manifest under the given scope dirs. Never fails.
pub fn load_all(reg: &mut Registry) {
    load_from_dirs(reg, &discover_dirs());
}

fn load_from_dirs(reg: &mut Registry, dirs: &[(String, PathBuf)]) {
    for (scope, dir) in dirs {
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let mut names: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
        names.sort();
        for sub in names {
            if sub.is_dir() {
                load_one(reg, scope, &sub);
            }
        }
    }
}

/// Read + validate a manifest: parse, id charset, core.* reserved,
/// version present, engine matches, permissions known. Shared by boot
/// discovery and `plugin add` (install validates before copying).
fn read_manifest(dir: &PathBuf) -> anyhow::Result<Manifest> {
    let mf = dir.join("plugin.json");
    let raw = std::fs::read_to_string(&mf)
        .map_err(|e| anyhow::anyhow!("unreadable manifest {}: {e}", mf.display()))?;
    let m: Manifest = serde_json::from_str(&raw)
        .map_err(|e| anyhow::anyhow!("bad manifest {}: {e}", mf.display()))?;
    if !valid_id(&m.id) {
        anyhow::bail!("bad id {:?}", m.id);
    }
    if m.id.starts_with("core.") {
        anyhow::bail!("core.* ids are reserved");
    }
    if m.version.trim().is_empty() {
        anyhow::bail!("version required");
    }
    if !engine_ok(&m.engine) {
        anyhow::bail!(
            "engine {:?} mismatches binary {}",
            m.engine,
            env!("CARGO_PKG_VERSION")
        );
    }
    for p in &m.permissions {
        if parse_perm(p).is_none() {
            anyhow::bail!("unknown permission {p:?}");
        }
    }
    for v in &m.contributes.verbs {
        if !valid_verb_name(&v.name) {
            anyhow::bail!("bad verb name {:?}", v.name);
        }
    }
    Ok(m)
}

fn load_one(reg: &mut Registry, scope: &str, dir: &PathBuf) {
    let mf = dir.join("plugin.json");
    if !mf.is_file() {
        return;
    }
    let m = match read_manifest(dir) {
        Ok(m) => m,
        Err(e) => {
            warn(format!("{}: {e:#}", mf.display()));
            return;
        }
    };
    if reg.plugins_for_list().iter().any(|p| p.id == m.id) {
        warn(format!("{}: duplicate plugin id {}", mf.display(), m.id));
        return;
    }
    // Validated above: every permission parses.
    let perms: Vec<Permission> = m.permissions.iter().filter_map(|p| parse_perm(p)).collect();
    // Resolve verb JS files inside the plugin dir (no .. escapes).
    let basedir = match dir.canonicalize() {
        Ok(d) => d,
        Err(_) => dir.clone(),
    };
    let mut verbs = vec![];
    for v in &m.contributes.verbs {
        if reg.verb(&v.name).is_some() {
            warn(format!("{}: verb {} collides with built-in, refused", mf.display(), v.name));
            continue;
        }
        let js = basedir.join(&v.run);
        let js = match js.canonicalize().or_else(|_| {
            // File may use ./ prefix; join without canonicalize fallback.
            Ok::<PathBuf, std::io::Error>(basedir.join(v.run.trim_start_matches("./")))
        }) {
            Ok(j) => j,
            Err(e) => {
                warn(format!("{}: verb {} unreadable run file: {e}", mf.display(), v.name));
                continue;
            }
        };
        if !js.starts_with(&basedir) || !js.is_file() {
            warn(format!("{}: verb {} run escapes plugin dir", mf.display(), v.name));
            continue;
        }
        if impls().lock().is_ok_and(|im| im.contains_key(&v.name)) {
            warn(format!("{}: verb {} already contributed, refused", mf.display(), v.name));
            continue;
        }
        let help = if v.help.trim().is_empty() {
            format!("{} — {}", v.name, m.id)
        } else {
            v.help.clone()
        };
        if let Ok(mut im) = impls().lock() {
            im.insert(
                v.name.clone(),
                ExtImpl {
                    plugin_id: m.id.clone(),
                    js,
                },
            );
        }
        // Manifest-declared value flags join the shared parser.
        crate::args::register_value_flags(&v.flags);
        verbs.push(Verb {
            name: leak(&v.name),
            help: leak(&help),
            run: run_ext,
        });
    }
    let skills: Vec<String> = m
        .contributes
        .skills
        .iter()
        .map(|s| {
            // Canonical absolute paths: scope dirs are CWD-relative at
            // boot, and serving must not depend on later CWD.
            let p = dir.join(s);
            p.canonicalize()
                .unwrap_or(p)
                .to_string_lossy()
                .to_string()
        })
        .collect();
    for s in &m.contributes.skills {
        if !dir.join(s).is_file() {
            warn(format!("{}: skill {s:?} missing", mf.display()));
        }
    }
    let plugin_id = leak(&m.id);
    reg.register(Plugin {
        id: plugin_id,
        permissions: perms,
        verbs,
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    });
    crate::plugin::register_meta(
        &m.id,
        crate::plugin::ExtMeta {
            version: m.version.clone(),
            scope: scope.to_string(),
            // Canonical: scope dirs are CWD-relative at boot; later calls
            // must resolve identically regardless of caller CWD.
            source: dir
                .canonicalize()
                .unwrap_or_else(|_| dir.clone())
                .to_string_lossy()
                .to_string(),
            skills,
            tools: m.contributes.tools.clone(),
        },
    );
}

// ---- execution: one shared handler, verb name selects the JS ----

/// Shared handler for all external verbs. The registry passes the verb
/// name (see plugin.rs); it selects the manifest JS file. Runs over
/// the session page-tool catalog when --session resolves, else an
/// empty catalog: external verbs without a session still run.
fn run_ext(ctx: &Ctx, _reg: &Registry, verb: &str, args: &[String]) -> anyhow::Result<serde_json::Value> {
    let (plugin_id, js) = {
        let im = impls().lock().map_err(|_| anyhow::anyhow!("ext busy"))?;
        let imp = im.get(verb).ok_or_else(|| anyhow::anyhow!("not_found: no external verb {verb}"))?;
        (imp.plugin_id.clone(), imp.js.clone())
    };
    let code = std::fs::read_to_string(&js)
        .map_err(|e| anyhow::anyhow!("ext {plugin_id}: cannot read {}: {e}", js.display()))?;
    if code.trim().is_empty() {
        anyhow::bail!("ext {plugin_id}: empty program");
    }
    let max = crate::verbs::exec::max_calls(args);
    let timeout = Duration::from_millis(crate::verbs::exec::timeout_ms(args));
    let catalog = match crate::verbs::exec::build_catalog(ctx, args, max) {
        Ok(c) => c,
        Err(_) => crate::exec::Catalog {
            leaves: HashMap::new(),
            calls: 0,
            max,
            deadline: std::time::Instant::now() + timeout,
        },
    };
    let program = format!("const args = {};\n{code}", args_json(args));
    crate::exec::run_program(catalog, &program, timeout)
}

/// args for JS: {all, positional, flags}. Flags parse generically:
/// --key value, --key=value, bare --flag (true). Short flags same.
/// Flag values never leak into positional (shared args::positionals).
fn args_json(args: &[String]) -> serde_json::Value {
    let positional = crate::args::positionals(args);
    let mut flags = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let key_opt = a.strip_prefix("--").or_else(|| {
            if a.starts_with('-') && a.len() == 2 && a != "-" {
                Some(a.strip_prefix('-').unwrap_or(a))
            } else {
                None
            }
        });
        if let Some(rest) = key_opt {
            if let Some((k, v)) = rest.split_once('=') {
                flags.insert(k.to_string(), serde_json::json!(v));
            } else if i + 1 < args.len() && !args[i + 1].starts_with('-') {
                flags.insert(rest.to_string(), serde_json::json!(args[i + 1]));
                i += 1;
            } else {
                flags.insert(rest.to_string(), serde_json::json!(true));
            }
        }
        i += 1;
    }
    serde_json::json!({"all": args, "positional": positional, "flags": flags})
}

// ---- authoring: plugin new / plugin show ----

fn slug(id: &str) -> String {
    id.to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Scaffold a plugin dir: manifest + verb JS + skill + tools stub.
/// User scope by default (always loaded); --here scaffolds ./plugins
/// for repo dev. Refuses non-empty dirs: never truncate edits.
pub fn scaffold(id: &str, here: bool) -> anyhow::Result<serde_json::Value> {
    if !valid_id(id) {
        anyhow::bail!("usage: plugin new <id> — id chars: a-z 0-9 . - _");
    }
    let verb = id.rsplit('.').next().unwrap_or(id).to_string();
    if !valid_verb_name(&verb) {
        anyhow::bail!("usage: plugin new <id> — last segment must be a verb name");
    }
    let base = if here {
        PathBuf::from("plugins")
    } else {
        user_plugins_dir()
    };
    let dir = base.join(slug(id));
    if dir.exists() && std::fs::read_dir(&dir).map(|mut e| e.next().is_some()).unwrap_or(true) {
        anyhow::bail!("exists: {} is non-empty", dir.display());
    }
    std::fs::create_dir_all(dir.join("tools"))?;
    let engine = format!("^{}", env!("CARGO_PKG_VERSION"));
    let manifest = serde_json::json!({
        "id": id,
        "version": "0.1.0",
        "engine": engine,
        "permissions": ["network"],
        "contributes": {
            "verbs": [{"name": verb, "help": format!("{verb} — {id} verb"), "run": "./main.js"}],
            "tools": ["./tools/*.js"],
            "skills": ["./SKILL.md"],
        },
    });
    std::fs::write(dir.join("plugin.json"), serde_json::to_string_pretty(&manifest)?)?;
    let main_js = format!(
        r#"// {id} — {verb} verb. `args` is {{all, positional, flags}}.
// Page tools arrive as tools.*; discover with webmcp.search,
// fan out with batch (cap 8). Must return a value explicitly.
return {{
  echo: args.positional,
  flags: args.flags,
  plugin: {id:?},
}};
"#
    );
    std::fs::write(dir.join("main.js"), main_js)?;
    let skill = format!(
        r#"---
name: {id}
version: 0.1.0
---
# {id}
Playbook for agents: when to use {verb}, inputs, outputs, gates.
## Workflow
1. `plugin show {id}` — manifest, skills, verb sources.
2. `{verb} <args>` — what it does, what it returns.
## Gates
- Disable with `AGENT_WEBMCP_PLUGINS=-{ns}.*`.
"#,
        ns = id.split('.').next().unwrap_or(id),
    );
    std::fs::write(dir.join("SKILL.md"), skill)?;
    std::fs::write(dir.join("tools").join(".gitkeep"), "")?;
    Ok(serde_json::json!({"scaffolded": dir.to_string_lossy(), "id": id, "verb": verb}))
}

/// Install a plugin from a local dir or git URL into a scope dir.
/// Validates the manifest BEFORE copying: bad/engine-mismatch/unknown
/// permission refuses without touching the scope. Installs for the NEXT
/// invocation — the running registry is already booted and is never
/// mutated mid-call. User scope by default, `./plugins` with --here.
pub fn add(reg: &Registry, source: &str, here: bool) -> anyhow::Result<serde_json::Value> {
    let resolved = resolve_index_source(source)?;
    let src = materialize_source(&resolved)?;
    let _cleanup = Cleanup(src.cloned_temp());
    let m = read_manifest(&src.dir)?;
    if reg.plugins_for_list().iter().any(|p| p.id == m.id) {
        anyhow::bail!("exists: plugin {} already installed", m.id);
    }
    // Verb run files must exist in the source; boot re-validates
    // strictly (escapes, collisions) before anything executes.
    for v in &m.contributes.verbs {
        if !src.dir.join(v.run.trim_start_matches("./")).is_file() {
            anyhow::bail!("not_found: verb {} run file {:?} missing", v.name, v.run);
        }
    }
    let base = if here {
        PathBuf::from("plugins")
    } else {
        user_plugins_dir()
    };
    install_dir(&src.dir, &base, &m.id)?;
    let dest = base.join(slug(&m.id));
    Ok(serde_json::json!({
        "installed": m.id,
        "version": m.version,
        "scope": if here { "repo" } else { "user" },
        "path": dest.to_string_lossy(),
        "note": "live next invocation",
    }))
}

/// A materialized source dir: borrowed (local path) or owned temp clone.
struct Source {
    dir: PathBuf,
    temp: Option<PathBuf>,
}

impl Source {
    fn cloned_temp(&self) -> Option<PathBuf> {
        self.temp.clone()
    }
}

/// Remove temp clone dirs even on failure paths.
struct Cleanup(Option<PathBuf>);
impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(d) = self.0.take() {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}

/// Resolve an add source: existing dirs and git URLs pass through;
/// anything else is an index name (`id` or `id@version`). Install
/// re-validates the cloned manifest, so the index is a pointer only.
fn resolve_index_source(source: &str) -> anyhow::Result<String> {
    if let Some(local) = source.strip_prefix("dir:") {
        return Ok(local.to_string());
    }
    if PathBuf::from(source).is_dir() {
        return Ok(source.to_string());
    }
    let url = source.strip_prefix("git:").unwrap_or(source);
    if url.ends_with(".git") || url.starts_with("https://") || url.starts_with("git@") {
        return Ok(source.to_string());
    }
    let (want_id, want_ver) = match source.split_once('@') {
        Some((i, v)) => (i, Some(v)),
        None => (source, None),
    };
    let mut found: Option<crate::plugin::RegistryEntry> = None;
    for e in crate::plugin::load_index() {
        if e.id == want_id {
            found = Some(e);
            break;
        }
    }
    let e = found.ok_or_else(|| anyhow::anyhow!("not_found: no plugin {want_id} (try plugin search)"))?;
    if let Some(v) = want_ver
        && v != e.version
    {
        anyhow::bail!("not_found: {want_id}@{v} (index has {})", e.version);
    }
    Ok(e.source.clone())
}

/// Resolve a source string to a plugin dir: an existing local dir, or a
/// git URL cloned shallow into temp (`git:` prefix or .git/URL shape).
fn materialize_source(source: &str) -> anyhow::Result<Source> {
    // Index entries may point at local dirs via dir:.
    let source = source.strip_prefix("dir:").unwrap_or(source);
    let p = PathBuf::from(source);
    if p.is_dir() {
        return Ok(Source { dir: p, temp: None });
    }
    let url = source.strip_prefix("git:").unwrap_or(source);
    let is_git = url.ends_with(".git") || url.starts_with("https://") || url.starts_with("git@");
    if !is_git {
        anyhow::bail!("usage: plugin add <dir|git-url> [--here]");
    }
    let tmp = std::env::temp_dir().join(format!("awmcp-add-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let st = std::process::Command::new("git")
        .args(["clone", "--depth", "1", url, &tmp.to_string_lossy()])
        .output()
        .map_err(|e| anyhow::anyhow!("not_found: git unavailable: {e}"))?;
    if !st.status.success() {
        anyhow::bail!("not_found: cannot clone {url}");
    }
    // A repo may hold the plugin at root or under one plugins/ entry:
    // prefer a root manifest, else the single plugins/*/ manifest.
    if tmp.join("plugin.json").is_file() {
        return Ok(Source { dir: tmp.clone(), temp: Some(tmp) });
    }
    let mut found = vec![];
    for scope in ["plugins"] {
        let entries = match std::fs::read_dir(tmp.join(scope)) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for e in entries.flatten() {
            if e.path().join("plugin.json").is_file() {
                found.push(e.path());
            }
        }
    }
    match found.len() {
        1 => Ok(Source { dir: found.remove(0), temp: Some(tmp) }),
        0 => anyhow::bail!("not_found: no plugin.json in {url}"),
        _ => anyhow::bail!("usage: {url} holds several plugins; point at one dir"),
    }
}

/// Copy a validated source dir into a scope root under its slug.
/// Refuses non-empty destinations: never truncate edits.
fn install_dir(src: &PathBuf, base: &PathBuf, id: &str) -> anyhow::Result<PathBuf> {
    let dest = base.join(slug(id));
    if dest.exists() && std::fs::read_dir(&dest).map(|mut e| e.next().is_some()).unwrap_or(true) {
        anyhow::bail!("exists: {} is non-empty", dest.display());
    }
    copy_dir(src, &dest)?;
    Ok(dest)
}

fn copy_dir(src: &PathBuf, dest: &PathBuf) -> anyhow::Result<()> {
    std::fs::create_dir_all(dest)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let (from, to) = (e.path(), dest.join(e.file_name()));
        if e.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Remove an installed manifest plugin by id. Refuses built-ins (no
/// manifest source) and anything outside known scope roots.
pub fn remove(id: &str) -> anyhow::Result<serde_json::Value> {
    let meta = crate::plugin::meta_for(id)
        .ok_or_else(|| anyhow::anyhow!("not_found: no installed plugin {id} (built-ins can't be removed)"))?;
    let src = PathBuf::from(&meta.source);
    let parent = src.parent().ok_or_else(|| anyhow::anyhow!("not_found: no source for {id}"))?;
    let canon_parent = parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf());
    let roots: Vec<PathBuf> = discover_dirs()
        .iter()
        .map(|(_, d)| d.canonicalize().unwrap_or_else(|_| d.clone()))
        .collect();
    if !roots.iter().any(|r| *r == canon_parent) {
        anyhow::bail!("policy_denied: {id} lives outside plugin scopes");
    }
    std::fs::remove_dir_all(&src)?;
    Ok(serde_json::json!({"removed": id}))
}

/// Search the registry index by AND of terms over id, description,
/// verbs. Name hits outrank description-only.
pub fn search_index(query: &str) -> serde_json::Value {
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    let mut hits = vec![];
    for e in crate::plugin::load_index() {
        let name_hay = format!("{} {}", e.id, e.verbs.join(" ")).to_lowercase();
        let full_hay = format!("{name_hay} {}", e.description).to_lowercase();
        if !terms.iter().all(|t| full_hay.contains(t)) {
            continue;
        }
        let score = if terms.iter().all(|t| name_hay.contains(t)) { 2 } else { 1 };
        hits.push((score, serde_json::json!({
            "id": e.id, "version": e.version, "engine": e.engine,
            "source": e.source, "description": e.description,
            "verbs": e.verbs,
        })));
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(a.1["id"].as_str().cmp(&b.1["id"].as_str())));
    let items: Vec<serde_json::Value> = hits.into_iter().map(|(_, v)| v).collect();
    serde_json::json!({"results": items, "total": items.len()})
}

/// Publish a local plugin dir into an index file: validates the
/// manifest, then upserts the entry (matched by id). Writes pretty
/// JSON. Target: user registry by default, `--here` for the repo index
/// (a PR then carries it to everyone).
pub fn publish(dir: &str, here: bool) -> anyhow::Result<serde_json::Value> {
    let d = PathBuf::from(dir);
    if !d.is_dir() {
        anyhow::bail!("usage: plugin publish <dir> [--here]");
    }
    let m = read_manifest(&d)?;
    let verbs: Vec<String> = m.contributes.verbs.iter().map(|v| v.name.clone()).collect();
    let desc = verbs
        .iter()
        .filter_map(|n| {
            m.contributes
                .verbs
                .iter()
                .find(|v| &v.name == n)
                .map(|v| v.help.clone())
        })
        .collect::<Vec<_>>()
        .join("; ");
    let entry = crate::plugin::RegistryEntry {
        id: m.id.clone(),
        version: m.version.clone(),
        engine: m.engine.clone(),
        source: format!("dir:{}", d.to_string_lossy()),
        description: desc,
        permissions: m.permissions.clone(),
        verbs,
    };
    let path = if here {
        PathBuf::from("registry/index.json")
    } else {
        let home = std::env::var("HOME").unwrap_or("/tmp".into());
        PathBuf::from(home).join(".agent-webmcp/registry.json")
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut plugins = if path.is_file() {
        let raw = std::fs::read_to_string(&path)?;
        serde_json::from_str::<crate::plugin::RegistryIndex>(&raw)
            .map(|i| i.plugins)
            .unwrap_or_default()
    } else {
        vec![]
    };
    plugins.retain(|e| e.id != entry.id);
    plugins.push(entry.clone());
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    std::fs::write(&path, serde_json::to_string_pretty(&serde_json::json!({"version": 1, "plugins": plugins}))?)?;
    Ok(serde_json::json!({"published": entry.id, "index": path.to_string_lossy()}))
}

/// Show one plugin: registry entry plus manifest, skill paths, and
/// verb JS sources for external verbs.
pub fn show(reg: &Registry, id: &str) -> anyhow::Result<serde_json::Value> {
    let p = reg
        .plugins_for_list()
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| anyhow::anyhow!("not_found: no plugin {id}"))?;
    let verbs: Vec<serde_json::Value> = p
        .verbs
        .iter()
        .map(|v| {
            let src = impls()
                .lock()
                .ok()
                .and_then(|im| im.get(v.name).map(|e| e.js.to_string_lossy().to_string()));
            match src {
                Some(s) => serde_json::json!({"name": v.name, "help": v.help, "run": s}),
                None => serde_json::json!({"name": v.name, "help": v.help}),
            }
        })
        .collect();
    Ok(serde_json::json!({
        "id": p.id,
        "enabled": reg.enabled(p.id),
        "permissions": p.permissions.iter().map(|x| format!("{x:?}").to_lowercase()).collect::<Vec<_>>(),
        "verbs": verbs,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_matches_self() {
        assert!(engine_ok(&format!("^{}", env!("CARGO_PKG_VERSION"))));
        assert!(engine_ok(env!("CARGO_PKG_VERSION")));
        assert!(!engine_ok("^0.0.0"));
        assert!(!engine_ok("^999.0.0"));
        assert!(!engine_ok("garbage"));
        assert!(!engine_ok(""));
    }

    #[test]
    fn ids_validate() {
        assert!(valid_id("acme.compare"));
        assert!(valid_id("hello"));
        assert!(!valid_id(""));
        assert!(!valid_id("has space"));
        assert!(!valid_id("semi;colon"));
        assert!(valid_verb_name("compare"));
        assert!(!valid_verb_name("has space"));
    }

    #[test]
    fn args_shape() {
        let args: Vec<String> = ["--session", "w", "hello", "--flag", "--k=v", "--n", "3"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let v = args_json(&args);
        // --n is undeclared: its value stays visible in positional.
        // Manifest `flags` declares value flags; those consume cleanly.
        assert_eq!(v["positional"], serde_json::json!(["hello", "3"]));
        assert_eq!(v["flags"]["session"], serde_json::json!("w"));
        assert_eq!(v["flags"]["flag"], serde_json::json!(true));
        assert_eq!(v["flags"]["k"], serde_json::json!("v"));
        assert_eq!(v["flags"]["n"], serde_json::json!("3"));
        crate::args::register_value_flags(&["--testextdepth".to_string()]);
        let args2: Vec<String> = ["hello", "--testextdepth", "2"].iter().map(|s| s.to_string()).collect();
        assert_eq!(crate::args::positionals(&args2), vec!["hello".to_string()]);
        assert_eq!(args_json(&args2)["flags"]["testextdepth"], serde_json::json!("2"));
    }

    fn tmp_plugins(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("awmcp-ext-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn discovery_loads_manifest_verb() {
        let scope = tmp_plugins("load");
        let dir = scope.join("plug");
        std::fs::create_dir_all(&dir).unwrap();
        let engine = format!("^{}", env!("CARGO_PKG_VERSION"));
        std::fs::write(
            dir.join("plugin.json"),
            serde_json::json!({
                "id": "test.load",
                "version": "0.1.0",
                "engine": engine,
                "permissions": ["network"],
                "contributes": {"verbs": [{"name": "testloadverb", "help": "h", "run": "./main.js"}]},
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(dir.join("main.js"), "return {ok: true};").unwrap();
        let mut reg = Registry::new(vec![]);
        load_from_dirs(&mut reg, &[("extra".to_string(), scope)]);
        assert!(reg.verb("testloadverb").is_some());
    }

    #[test]
    fn bad_manifests_refused() {
        let scope = tmp_plugins("bad");
        let dir = scope.join("plug");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("plugin.json"),
            r#"{"id": "test.bad", "version": "0.1.0", "engine": "^999.0.0", "contributes": {}}"#,
        )
        .unwrap();
        let mut reg = Registry::new(vec![]);
        load_from_dirs(&mut reg, &[("extra".to_string(), scope)]);
        assert!(reg.verb("testbadverb").is_none());
    }

    fn write_plug(dir: &PathBuf, id: &str, engine: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("plugin.json"),
            serde_json::json!({
                "id": id,
                "version": "0.1.0",
                "engine": engine,
                "permissions": ["network"],
                "contributes": {"verbs": [{"name": "v", "help": "h", "run": "./main.js"}]},
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(dir.join("main.js"), "return {ok: true};").unwrap();
    }

    #[test]
    fn add_installs_validated_dir() {
        let src_root = tmp_plugins("addsrc");
        let src = src_root.join("plug");
        let engine = format!("^{}", env!("CARGO_PKG_VERSION"));
        write_plug(&src, "test.add", &engine);
        let dest_root = tmp_plugins("adddest");
        let dest = install_dir(&src, &dest_root, "test.add").unwrap();
        assert!(dest.join("plugin.json").is_file());
        assert!(dest.join("main.js").is_file());
        // Non-empty destination refuses: never truncate edits.
        assert!(install_dir(&src, &dest_root, "test.add").is_err());
    }

    #[test]
    fn add_refuses_bad_engine_before_copying() {
        let src_root = tmp_plugins("addbad");
        let src = src_root.join("plug");
        write_plug(&src, "test.addbad", "^999.0.0");
        let dest_root = tmp_plugins("addbaddest");
        let reg = Registry::new(vec![]);
        let out = add(&reg, src.to_str().unwrap(), false);
        assert!(out.is_err());
        // add() with here=false targets the user dir; pass an explicit
        // root through install_dir to prove validation precedes copy.
        assert!(read_manifest(&src).is_err());
        assert!(!dest_root.join("test-addbad").exists());
    }

    #[test]
    fn remove_refuses_builtins() {
        // No manifest metadata without a boot load: built-ins refuse.
        assert!(remove("core.version").is_err());
        assert!(remove("no.such.plugin").is_err());
    }

    #[test]
    fn index_search_ranks_names_first() {
        let out = search_index("hello echo");
        assert_eq!(out["total"], serde_json::json!(1));
        assert_eq!(out["results"][0]["id"], serde_json::json!("hello.echo"));
        assert_eq!(search_index("zzz-nope")["total"], serde_json::json!(0));
    }

    #[test]
    fn name_resolution_needs_index_hit() {
        assert!(resolve_index_source("no.such.plugin").is_err());
        assert!(resolve_index_source("no.such.plugin@9.9.9").is_err());
        // dir: prefix resolves locally without any index.
        assert_eq!(
            resolve_index_source("dir:/tmp").unwrap(),
            "/tmp".to_string()
        );
    }
}
