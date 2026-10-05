// Codemode execution: one JS program, N tool calls. The agent ships
// code; QuickJS runs it against the session's tool catalog; one
// envelope comes back. Composition lives here, not in N round trips.
//
// Sandbox rules (mirroring Cloudflare's shape, slimmed):
// - tools.* are the ONLY externals: live page tools + custom tools.
//   No fetch, no fs, no timers, no imports. Programs exercise authority
//   already present in the tools; they gain none through code.
// - webmcp.search/describe is progressive discovery: pull definitions
//   instead of receiving the catalog (Cloudflare's search/describe).
// - Calls are synchronous. Fan-out goes through batch() (sequential,
//   ordered results, cap 8). No event loop, no promises.
// - Top-level explicit return is required (IIFE wrap gives scope
//   isolation; a bare completion value does not survive, and undefined
//   is refused).
// - Budgets: max-calls (default 10, clamp 1..50), batch cap 8, wall
//   timeout. Every leaf call claims budget and checks the deadline.
// - Confirm-gated tools refuse inside execute: a program cannot pause
//   mid-run for a human.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Throw a JS string error carrying a tool_error message: catchable in
/// programs, fatal text outside them.
fn jserr(ctx: &rquickjs::Ctx<'_>, msg: String) -> rquickjs::Error {
    match rquickjs::String::from_str(ctx.clone(), &msg) {
        Ok(st) => ctx.throw(st.into_value()),
        Err(e) => e,
    }
}

/// One callable tool: name, description, required args, executor.
pub struct Leaf {
    pub name: String,
    pub desc: String,
    pub required: Vec<String>,
    pub run: Box<dyn Fn(&serde_json::Value) -> anyhow::Result<serde_json::Value> + Send + Sync>,
}

/// The session's callable set for one execution.
pub struct Catalog {
    pub leaves: HashMap<String, Leaf>,
    pub calls: usize,
    pub max: usize,
    pub deadline: Instant,
}

impl Catalog {
    pub fn claim(&mut self) -> anyhow::Result<()> {
        if Instant::now() >= self.deadline {
            anyhow::bail!("timeout: execution exceeded its budget");
        }
        self.calls += 1;
        if self.calls > self.max {
            anyhow::bail!("max_calls exceeded ({})", self.max);
        }
        Ok(())
    }

    pub fn names(&self) -> Vec<String> {
        let mut n: Vec<String> = self.leaves.keys().cloned().collect();
        n.sort();
        n
    }

    /// Ranked search over name+description: AND of space-separated
    /// substrings, exact-callable signatures back (mirrors list --query).
    /// limit/offset paginate (defaults 10/0); total reports the full count.
    pub fn search(&self, query: &str, limit: usize, offset: usize) -> (Vec<serde_json::Value>, usize) {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|t| t.to_lowercase())
            .filter(|t| !t.is_empty())
            .collect();
        let mut all = vec![];
        for leaf in self.leaves.values() {
            let hay = format!("{} {}", leaf.name, leaf.desc).to_lowercase();
            if terms.iter().all(|t| hay.contains(t)) {
                all.push(serde_json::json!({
                    "tool": leaf.name, "description": leaf.desc,
                    "required": leaf.required,
                }));
            }
        }
        all.sort_by(|a, b| a["tool"].as_str().cmp(&b["tool"].as_str()));
        let total = all.len();
        let page = all.into_iter().skip(offset).take(limit).collect();
        (page, total)
    }

    pub fn describe(&self, name: &str) -> anyhow::Result<serde_json::Value> {
        match self.leaves.get(name) {
            Some(leaf) => Ok(serde_json::json!({
                "tool": leaf.name, "description": leaf.desc,
                "required": leaf.required,
            })),
            None => anyhow::bail!("unknown tool {name}"),
        }
    }
}

type Shared = Arc<Mutex<Catalog>>;

/// Convert a QuickJS value to serde via JSON.stringify.
fn to_json<'js>(ctx: rquickjs::Ctx<'js>, v: rquickjs::Value<'js>) -> anyhow::Result<serde_json::Value> {
    let json: rquickjs::String = ctx.json_stringify(v)?.ok_or_else(|| anyhow::anyhow!("unstringifiable"))?;
    Ok(serde_json::from_str(&json.to_string()?)?)
}

/// Convert serde back: JSON text is valid JS for data values.
/// Failures surface the JS exception text, not the flat enum.
fn from_json<'js>(ctx: &rquickjs::Ctx<'js>, v: &serde_json::Value) -> anyhow::Result<rquickjs::Value<'js>> {
    // Parenthesized: object literals must parse as expressions, not blocks.
    let wrapped = format!("({v})");
    ctx.eval::<rquickjs::Value<'_>, _>(wrapped.as_bytes()).map_err(|e| {
        match rquickjs::CaughtError::from_error(ctx, e) {
            rquickjs::CaughtError::Exception(ex) => {
                let v = ex.into_value();
                let text = v
                    .as_object()
                    .and_then(|o| o.get::<_, String>("message").ok())
                    .unwrap_or_else(|| "exception".to_string());
                anyhow::anyhow!("js eval: {text}")
            }
            rquickjs::CaughtError::Value(v) => {
                let text = v
                    .as_string()
                    .and_then(|s| s.to_string().ok())
                    .unwrap_or_else(|| "error value".to_string());
                anyhow::anyhow!("js eval: {text}")
            }
            rquickjs::CaughtError::Error(e) => anyhow::anyhow!("js runtime: {e}"),
        }
    })
}

/// Execute one leaf: budget, required-args check, run, typed errors.
///
fn exec_leaf<'js>(
    ctx: &rquickjs::Ctx<'js>,
    shared: &Shared,
    name: &str,
    arg: rquickjs::Value<'js>,
) -> rquickjs::Result<rquickjs::Value<'js>> {
    let args = to_json(ctx.clone(), arg)
        .map_err(|e| jserr(ctx, format!("tool_error: bad args: {e}")))?;
    let args_obj = args.as_object().cloned().unwrap_or_default();
    let out: anyhow::Result<serde_json::Value> = (|| {
        let mut cat = shared.lock().map_err(|_| anyhow::anyhow!("tool_error: catalog busy"))?;
        cat.claim().map_err(|e| anyhow::anyhow!("tool_error: {e:#}"))?;
        let leaf = cat
            .leaves
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("tool_error: unknown tool {name}"))?;
        for req in &leaf.required.clone() {
            if args_obj.get(req).is_none() {
                anyhow::bail!("tool_error: tool {name} missing required {req:?}");
            }
        }
        (leaf.run)(&serde_json::Value::Object(args_obj))
    })();
    match out {
        Ok(v) => from_json(ctx, &v).map_err(|e| jserr(ctx, format!("tool_error: bad result: {e}"))),
        Err(e) => Err(jserr(ctx, format!("{e:#}"))),
    }
}

/// Run a program. Returns the JSON-marshaled explicit return.
pub fn run_program(
    catalog: Catalog,
    code: &str,
    timeout: Duration,
) -> anyhow::Result<serde_json::Value> {
    use rquickjs::{Context, Function};
    let shared: Shared = Arc::new(Mutex::new(Catalog {
        deadline: Instant::now() + timeout,
        ..catalog
    }));
    let rt = rquickjs::Runtime::new()?;
    rt.set_memory_limit(8 * 1024 * 1024);
    rt.set_max_stack_size(256 * 1024);
    let ctx = Context::full(&rt)?;
    ctx.with(|ctx| {
        let globals = ctx.globals();
        // tools.*: one function per leaf, single object arg.
        let tools = rquickjs::Object::new(ctx.clone())?;
        for name in shared.lock().unwrap().names() {
            let shared = shared.clone();
            let label = name.clone();
            let f = Function::new(ctx.clone(), move |ctx, arg| {
                exec_leaf(&ctx, &shared, &label, arg)
            })?;
            tools.set(name, f)?;
        }
        globals.set("tools", tools)?;
        // webmcp.search/describe: progressive discovery.
        let webmcp = rquickjs::Object::new(ctx.clone())?;
        {
            let shared = shared.clone();
            webmcp.set(
                "search",
                Function::new(ctx.clone(), move |q: String, lim: Option<usize>, off: Option<usize>| -> rquickjs::Result<String> {
                    let cat = shared.lock().unwrap();
                    let (page, total) =
                        cat.search(&q, lim.unwrap_or(10).clamp(1, 50), off.unwrap_or(0));
                    Ok(serde_json::json!({"results": page, "total": total}).to_string())
                })?,
            )?;
        }
        {
            let shared = shared.clone();
            webmcp.set(
                "describe",
                Function::new(ctx.clone(), move |ctx, name: String| -> rquickjs::Result<String> {
                    let cat = shared.lock().unwrap();
                    match cat.describe(&name) {
                        Ok(v) => Ok(v.to_string()),
                        Err(e) => Err(jserr(&ctx, format!("tool_error: {e:#}"))),
                    }
                })?,
            )?;
        }
        globals.set("webmcp", webmcp)?;
        // batch([{tool, args}]): defined in JS over tools.* so every
        // item flows through the same guarded host calls (budget,
        // required-args, tool_error catchables). Sequential, ordered,
        // capped at 8.
        let prelude = r#"function batch(items) {
  if (!Array.isArray(items)) throw 'tool_error: batch takes an array';
  if (items.length > 8) throw 'tool_error: batch capped at 8 items';
  const out = [];
  for (const it of items) {
    const fn = it && tools[it.tool];
    if (typeof fn !== 'function') throw 'tool_error: unknown tool ' + (it && it.tool);
    out.push(fn(it.args || {}));
  }
  return out;
}"#;
        ctx.eval::<(), _>(prelude.as_bytes())?;
        let wrapped = format!("(function(){{\n{code}\n}})()");
        let v: rquickjs::Value = ctx.eval(wrapped.as_bytes()).map_err(|e| {
            // Surface the JS exception text, not the flat error enum.
            match rquickjs::CaughtError::from_error(&ctx, e) {
                rquickjs::CaughtError::Exception(ex) => {
                    let text = ex
                        .into_value()
                        .as_object()
                        .and_then(|o| o.get::<_, String>("message").ok())
                        .unwrap_or_else(|| "exception".to_string());
                    anyhow::anyhow!("js: {text}")
                }
                rquickjs::CaughtError::Value(v) => {
                    let text = v
                        .as_string()
                        .and_then(|s| s.to_string().ok())
                        .unwrap_or_else(|| "error value".to_string());
                    anyhow::anyhow!("js: {text}")
                }
                rquickjs::CaughtError::Error(e) => anyhow::anyhow!("js runtime: {e}"),
            }
        })?;
        if v.type_of() == rquickjs::Type::Undefined {
            anyhow::bail!("no return: programs must return a value explicitly");
        }
        to_json(ctx, v)
    })
}

