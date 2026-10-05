// Browser verbs as plugins: open, observe. Each verb is a Plugin with
// a name, help, permissions, and a handler. The registry dispatches.
use crate::plugin::{Permission, Plugin, Verb};

const SNAP_JS: &str = r#"(() => {
  // Node registry: snapshot ids resolve to live nodes for act.
  // Rebuilt every snapshot; ids are per-snapshot, never cached.
  window.__awmcp = {nodes: {}};
  const vis = e => {
    try {
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true});
    } catch (err) { return false; }
  };
  const name = e => ((e.innerText || '').trim().split('\n')[0] || e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('value') || e.tagName.toLowerCase()).slice(0, 80);
  const roles = 'button,link,checkbox,radio,switch,tab,menuitem,combobox,textbox,searchbox,spinbutton';
  const out = [];
  let n = 0;
  const push = (kind, role, label, el) => {
    const id = 'e' + (++n);
    window.__awmcp.nodes[id] = el;
    out.push({id, kind, role, label});
  };
  document.querySelectorAll('a[href],button,input,select,textarea,[role]').forEach(e => {
    if (e.disabled || !vis(e)) return;
    const tag = e.tagName.toLowerCase();
    const role = e.getAttribute('role') || tag;
    if (tag === 'input') {
      const t = (e.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'image'].includes(t)) return;
      if (t === 'password' || t === 'file') return;
      if (['checkbox', 'radio'].includes(t)) push('click', t, name(e), e);
      else if (t === 'submit' || t === 'button') push('click', 'button', name(e), e);
      else push('fill', t, name(e), e);
    } else if (tag === 'select') {
      [...e.options].filter(o => !o.disabled).forEach(o => push('select', 'option', (o.textContent || '').trim().slice(0, 80), e));
    } else if (tag === 'textarea') push('fill', 'textarea', name(e), e);
    else if (roles.split(',').includes(role) || tag === 'button' || (tag === 'a' && e.hasAttribute('href'))) push('click', role, name(e), e);
  });
  out.push({id: 'scroll_down', kind: 'scroll', role: '', label: 'Scroll down'});
  out.push({id: 'scroll_up', kind: 'scroll', role: '', label: 'Scroll up'});
  return JSON.stringify({url: location.href, title: document.title, count: out.length, actions: out});
})()"#;

// Resolve a snapshot id to a click point: scroll into view, hit-test
// with elementFromPoint (occlusion refuses), return center coords.
// Trusted input happens host-side (CDP); this only measures.
pub(crate) const RESOLVE_JS: &str = r#"((id) => {
  const el = window.__awmcp && window.__awmcp.nodes[id];
  if (!el || !document.contains(el)) return JSON.stringify({ok: false, error: 'stale: re-observe'});
  try { el.scrollIntoView({block: 'center'}); } catch (err) {}
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return JSON.stringify({ok: false, error: 'no geometry'});
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return JSON.stringify({ok: false, error: 'off-viewport'});
  const hit = document.elementFromPoint(x, y);
  if (hit && hit !== el && !el.contains(hit)) {
    const cover = (hit.innerText || hit.tagName || '').trim().slice(0, 60);
    return JSON.stringify({ok: false, error: 'covered by ' + cover});
  }
  return JSON.stringify({ok: true, x, y});
})('__ID__')"#;

/// Evaluate JS, return the raw value (any JSON type).
fn eval_value(ws: &str, expr: &str) -> anyhow::Result<serde_json::Value> {
    let params = serde_json::json!({"expression": expr, "returnByValue": true}).to_string();
    let res = crate::cdp::call(ws, 1, "Runtime.evaluate", &params)?;
    let v = res["result"]["result"]["value"].clone();
    if v.is_null() {
        anyhow::bail!("eval_failed: no value");
    }
    Ok(v)
}

/// Evaluate JS that returns a JSON-stringified object (snapshots).
fn eval(ws: &str, expr: &str) -> anyhow::Result<serde_json::Value> {
    match eval_value(ws, expr)? {
        serde_json::Value::String(s) => {
            serde_json::from_str(&s).map_err(|_| anyhow::anyhow!("eval_failed: not JSON"))
        }
        v => Ok(v),
    }
}

/// Browser verbs: open, observe.
pub fn plugins() -> Vec<Plugin> {
    vec![
        Plugin {
            id: "browser.open",
            permissions: vec![Permission::Spawn, Permission::Network],
            verbs: vec![Verb {
                name: "open",
                help: "open <url> [--session NAME] [--profile NAME] [--headed] — reuse profile browser, navigate session tab",
                run: |ctx, _reg, _verb, args| {
                    // Positional URL: first bare arg that is not a flag
                    // value (--session/--profile values are skipped).
                    // --url works too for MCP-style {url} arguments.
                    let url = crate::args::flag(args, "--url").unwrap_or_else(|| {
                        crate::args::positionals(args)
                            .first()
                            .cloned()
                            .unwrap_or_else(|| "about:blank".to_string())
                    });
                    let session = ctx.session_for(args);
                    let profile = ctx.profile_for(args);
                    let headed = args.iter().any(|a| a == "--headed");
                    // Reuse: a session with a live browser keeps it
                    // (own or attached); otherwise ensure the profile's.
                    let (port, reused) = match crate::session::load(&session) {
                        Ok((port, _)) => (port, true),
                        Err(_) => crate::session::ensure_browser(&profile, headed)?,
                    };
                    let ws = crate::session::session_target(&session, port)?;
                    crate::cdp::call(&ws, 1, "Page.navigate", &format!(r#"{{"url":{url:?}}}"#))?;
                    // Same tab after navigate. about:blank never
                    // fires load; everything else enables-then-navigates
                    // on one connection so fast loads can't slip through.
                    if url != "about:blank" {
                        crate::cdp::navigate_and_wait(&ws, &url)?;
                    }
                    crate::session::save(&session, &profile, port, &url)?;
                    // Verified host-matched tools inject on every open.
                    // Best-effort: injection never fails the open.
                    let host = url
                        .split("://")
                        .nth(1)
                        .unwrap_or(url.as_str())
                        .split('/')
                        .next()
                        .unwrap_or(url.as_str());
                    let injected = crate::tools::inject_verified(&ws, host);
                    Ok(serde_json::json!({"session": session, "profile": profile, "url": url, "port": port, "reused": reused, "headed": headed, "customTools": injected}))
                },
            }],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
        Plugin {
            id: "browser.observe",
            permissions: vec![Permission::Network],
            verbs: vec![Verb {
                name: "observe",
                help: "observe [--session NAME] — snapshot: stable @eN refs + labels",
                run: |ctx, _reg, _verb, args| {
                    let (port, _) = crate::session::load(&ctx.session_for(args))?;
                    let ws = crate::session::session_target(&ctx.session_for(args), port)?;
                    let snap = eval(&ws, SNAP_JS)?;
                    Ok(snap)
                },
            },
            Verb {
                name: "eval",
                help: "eval <js> [--session NAME] — run JavaScript, return value",
                run: |ctx, _reg, _verb, args| {
                    let expr = crate::args::positionals(args).first().cloned().unwrap_or_default();
                    if expr.is_empty() {
                        anyhow::bail!("usage: eval <js> [--session NAME]");
                    }
                    let (port, _) = crate::session::load(&ctx.session_for(args))?;
                    let ws = crate::session::session_target(&ctx.session_for(args), port)?;
                    let v = eval_value(&ws, &expr)?;
                    Ok(serde_json::json!({"value": v, "untrusted": true}))
                },
            }
            ],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
        Plugin {
            id: "browser.lifecycle",
            permissions: vec![Permission::Spawn, Permission::Network],
            verbs: vec![
                Verb {
                    name: "close",
                    help: "close [--session NAME] [--all] — shut the session tab, or every profile browser",
                    run: |ctx, _reg, _verb, args| {
                        let all = args.iter().any(|a| a == "--all");
                        if all {
                            let killed = crate::session::kill_all();
                            return Ok(serde_json::json!({"closed": killed}));
                        }
                        let session = ctx.session_for(args);
                        let closed = crate::session::close_session(&session);
                        Ok(serde_json::json!({"session": session, "closed": closed}))
                    },
                },
                Verb {
                    name: "sessions",
                    help: "sessions — known sessions with liveness and urls",
                    run: |_ctx, _reg, _verb, _args| {
                        Ok(serde_json::json!({"sessions": crate::session::list_all()}))
                    },
                },
            ],
            hooks: crate::plugin::Hooks {
                before: None,
                after: None,
            },
        },
    ]
}
