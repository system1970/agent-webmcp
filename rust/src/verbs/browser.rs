// Browser verbs as plugins: open, observe. Each verb is a Plugin with
// a name, help, permissions, and a handler. The registry dispatches.
use crate::plugin::{Permission, Plugin, Verb};

const SNAP_JS: &str = r#"(() => {
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
  const push = (kind, role, label) => out.push({id: 'e' + (++n), kind, role, label});
  document.querySelectorAll('a[href],button,input,select,textarea,[role]').forEach(e => {
    if (e.disabled || !vis(e)) return;
    const tag = e.tagName.toLowerCase();
    const role = e.getAttribute('role') || tag;
    if (tag === 'input') {
      const t = (e.type || 'text').toLowerCase();
      if (['hidden', 'submit', 'image'].includes(t)) return;
      if (t === 'password' || t === 'file') return;
      if (['checkbox', 'radio'].includes(t)) push('click', t, name(e));
      else if (t === 'submit' || t === 'button') push('click', 'button', name(e));
      else push('fill', t, name(e));
    } else if (tag === 'select') {
      [...e.options].filter(o => !o.disabled).forEach(o => push('select', 'option', (o.textContent || '').trim().slice(0, 80)));
    } else if (tag === 'textarea') push('fill', 'textarea', name(e));
    else if (roles.split(',').includes(role) || tag === 'button' || (tag === 'a' && e.hasAttribute('href'))) push('click', role, name(e));
  });
  out.push({id: 'scroll_down', kind: 'scroll', role: '', label: 'Scroll down'});
  out.push({id: 'scroll_up', kind: 'scroll', role: '', label: 'Scroll up'});
  return JSON.stringify({url: location.href, title: document.title, count: out.length, actions: out});
})()"#;

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
                help: "open <url> [--session NAME] — launch headless Chromium, navigate, wait load",
                run: |ctx, _reg, args| {
                    let url = args
                        .iter()
                        .find(|a| !a.starts_with('-'))
                        .map(|s| s.as_str())
                        .unwrap_or("about:blank");
                    let session = ctx.session_for(args);
                    let port = crate::cdp::free_port();
                    let child = crate::cdp::launch_chrome(port)?;
                    crate::cdp::wait_http(port)?;
                    let ws = crate::cdp::first_page(port)?;
                    crate::cdp::call(&ws, 1, "Page.navigate", &format!(r#"{{"url":{url:?}}}"#))?;
                    crate::cdp::wait_load(&ws)?;
                    crate::session::save(&session, port, url)?;
                    std::mem::forget(child);
                    Ok(serde_json::json!({"session": session, "url": url, "port": port}))
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
                run: |ctx, _reg, args| {
                    let (port, _) = crate::session::load(&ctx.session_for(args))?;
                    let ws = crate::cdp::first_page(port)?;
                    let snap = eval(&ws, SNAP_JS)?;
                    Ok(snap)
                },
            },
            Verb {
                name: "eval",
                help: "eval <js> [--session NAME] — run JavaScript, return value",
                run: |ctx, _reg, args| {
                    let expr = args
                        .iter()
                        .find(|a| !a.starts_with('-'))
                        .cloned()
                        .unwrap_or_default();
                    if expr.is_empty() {
                        anyhow::bail!("usage: eval <js> [--session NAME]");
                    }
                    let (port, _) = crate::session::load(&ctx.session_for(args))?;
                    let ws = crate::cdp::first_page(port)?;
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
    ]
}
