// Actuation verbs: click, fill. Trusted CDP input (user gestures),
// measured in-page (scroll, hit-test, read-back), executed host-side.
// Disable-able via control syntax; governed by core.policy.
//
// Every action resolves its snapshot id fresh: stale ids, occluded
// targets, and off-viewport points refuse with a remedy (re-observe),
// never a blind click.
use crate::plugin::{Plugin, Verb};

/// Resolve @id to a click point through the snapshot registry.
/// Returns (x, y) or a refusal naming the remedy.
fn resolve(
    ws: &str,
    id: &str,
) -> anyhow::Result<(f64, f64)> {
    let expr = super::browser::RESOLVE_JS.replace("__ID__", id);
    let params = serde_json::json!({"expression": expr, "returnByValue": true}).to_string();
    let res = crate::cdp::call(ws, 1, "Runtime.evaluate", &params)?;
    let raw = res["result"]["result"]["value"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("resolve_failed: no registry (re-observe)"))?;
    let v: serde_json::Value = serde_json::from_str(raw)
        .map_err(|_| anyhow::anyhow!("resolve_failed: unreadable registry (re-observe)"))?;
    if v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
        let x = v.get("x").and_then(|n| n.as_f64()).unwrap_or(-1.0);
        let y = v.get("y").and_then(|n| n.as_f64()).unwrap_or(-1.0);
        return Ok((x, y));
    }
    let err = v.get("error").and_then(|e| e.as_str()).unwrap_or("unknown");
    anyhow::bail!("stale_target: {err}")
}

// Read a registered node's live value for fill verification.
const READ_JS: &str = r#"((id) => {
  const el = window.__awmcp && window.__awmcp.nodes[id];
  if (!el || !document.contains(el)) return JSON.stringify({ok: false});
  return JSON.stringify({ok: true, value: ('value' in el) ? el.value : null});
})('__ID__')"#;

// Fallback setter: native setter + input event (insertText preferred).
const DOMSET_JS: &str = r#"((id, v) => {
  const el = window.__awmcp && window.__awmcp.nodes[id];
  if (!el || !document.contains(el)) return JSON.stringify({ok: false});
  try {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, v); else el.value = v;
  } catch (err) { el.value = v; }
  el.dispatchEvent(new Event('input', {bubbles: true}));
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return JSON.stringify({ok: el.value === v, value: el.value});
})('__ID__', __VAL__)"#;

fn read_value(ws: &str, id: &str) -> Option<String> {
    let expr = READ_JS.replace("__ID__", id);
    let params = serde_json::json!({"expression": expr, "returnByValue": true}).to_string();
    let res = crate::cdp::call(ws, 1, "Runtime.evaluate", &params).ok()?;
    let raw = res["result"]["result"]["value"].as_str()?;
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    if v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
        return v.get("value").and_then(|x| x.as_str()).map(str::to_string);
    }
    None
}

/// Actuation verbs: click, fill.
pub fn plugins() -> Vec<Plugin> {
    vec![Plugin {
        id: "browser.act",
        permissions: vec![crate::plugin::Permission::Network],
        verbs: vec![
            Verb {
                name: "click",
                help: "click <@eN> [--session NAME] — trusted click on a snapshot target",
                run: |ctx, _reg, _verb, args| {
                    let id = crate::args::positionals(args)
                        .first()
                        .cloned()
                        .ok_or_else(|| anyhow::anyhow!("usage: click <@eN> [--session NAME]"))?;
                    let id = id.trim_start_matches('@');
                    let session = ctx.session_for(args);
                    let (port, _) = crate::session::load(&session)?;
                    let ws = crate::session::session_target(&session, port)?;
                    let (x, y) = resolve(&ws, id)?;
                    crate::cdp::mouse_click(&ws, x, y)?;
                    Ok(serde_json::json!({"clicked": id, "x": x, "y": y, "executed": true}))
                },
            },
            Verb {
                name: "fill",
                help: "fill <@eN> <text> [--session NAME] [--submit] — focus, trusted text entry, read-back verified",
                run: |ctx, _reg, _verb, args| {
                    let pos = crate::args::positionals(args);
                    let id = pos
                        .first()
                        .cloned()
                        .ok_or_else(|| anyhow::anyhow!("usage: fill <@eN> <text> [--session NAME]"))?;
                    let id = id.trim_start_matches('@');
                    let text = pos.get(1).cloned().unwrap_or_default();
                    if text.is_empty() {
                        anyhow::bail!("usage: fill <@eN> <text> [--session NAME]");
                    }
                    let submit = crate::args::has(args, "--submit");
                    let session = ctx.session_for(args);
                    let (port, _) = crate::session::load(&session)?;
                    let ws = crate::session::session_target(&session, port)?;
                    let (x, y) = resolve(&ws, id)?;
                    crate::cdp::mouse_click(&ws, x, y)?;
                    crate::cdp::insert_text(&ws, &text)?;
                    let mut verified = read_value(&ws, id).as_deref() == Some(text.as_str());
                    if !verified {
                        // Fallback: native setter + input event, then re-read.
                        let expr = DOMSET_JS
                            .replace("__ID__", id)
                            .replace("__VAL__", &serde_json::json!(text).to_string());
                        let params = serde_json::json!({"expression": expr, "returnByValue": true}).to_string();
                        if let Ok(res) = crate::cdp::call(&ws, 1, "Runtime.evaluate", &params)
                            && let Some(raw) = res["result"]["result"]["value"].as_str()
                                && let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
                                    verified = v.get("ok").and_then(|o| o.as_bool()).unwrap_or(false);
                                }
                    }
                    if !verified {
                        anyhow::bail!("fill_failed: read-back mismatch (re-observe)");
                    }
                    if submit {
                        let expr = format!(
                            r#"(() => {{ const el = window.__awmcp.nodes[{id:?}];
                                const f = el && (el.form || el.closest('form'));
                                const b = (f && f.querySelector('input[type="submit"],button[type="submit"],button:not([type])'))
                                    || document.querySelector('input[type="submit"],button[type="submit"]');
                                if (b) {{ b.click(); return 'submitted'; }} return 'no-submit'; }})()"#
                        );
                        let params = serde_json::json!({"expression": expr, "returnByValue": true}).to_string();
                        let res = crate::cdp::call(&ws, 1, "Runtime.evaluate", &params)?;
                        let state = res["result"]["result"]["value"].as_str().unwrap_or("").to_string();
                        return Ok(serde_json::json!({"filled": id, "verified": true, "submit": state}));
                    }
                    Ok(serde_json::json!({"filled": id, "verified": true}))
                },
            },
        ],
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    }]
}
