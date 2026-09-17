// agent-webmcp overlay for vercel.com/docs: Ask AI panel verbs.
// Cloned 2026-09-15 from the flags-sdk skill (same eve panel family),
// re-grounded live on vercel.com/docs. Verbs: open, ask, read,
// clear, close.
//
// Grounded panel facts (vercel.com/docs, headful):
// - Trigger: BUTTON "Ask AI" (visible). Click opens the panel.
// - Composer: TEXTAREA "What would you like to know?". Single, no id —
//   ground by placeholder, never cache the node (framework swaps it).
// - Submit: BUTTON "Submit" (label differs per site — never "Send").
//   Enabled once text lands via native setter + input event.
// - Suggestions on a fresh panel; echo + answer + "Used N sources"
//   line per turn. The sources line is the completion marker —
//   settle = sources present AND text stable twice.
// - Controls: "Copy chat as markdown", "Clear chat" (armed while
//   history exists = no-op when fresh), "Close chat", plus a "Copy
//   prompt" page extra (not a verb).
//   Clear is a SERVER-SIDE wipe on this tenant (verified 2026-09-15:
//   close+reopen WITHOUT clear re-seats history; clear+close+reopen
//   leaves it gone). Probe both states before writing the manual.
// - Natives: NONE on this tenant (empty `list`) — panel only.
// - API-first lead (trace dump 2026-09-15): POST
//   https://vercel.com/api/ai-chat (200, 22KB, ~8.3s) carries the turn
//   plus POST .../api/ai-chat/title. Different path shape from the
//   family's /api/chat — same completion markers. Unproven direct
//   substitute.
// Install: agent-webmcp tools add overlay.js --for vercel.com
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = (el) => { try { return el.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0 }; } };

  function onScreen(el) {
    // Vercel docks the panel off-canvas when closed (composer keeps its
    // size at x > viewport) — size alone is NOT an open signal.
    const r = rect(el);
    return r.width > 100 && r.height > 20 &&
      r.x > -8 && (r.x + r.width) <= window.innerWidth + 8;
  }
  function askButton() {
    // Visible-first: document order may lead with an off-canvas dup.
    const all = [...document.querySelectorAll('button')]
      .filter((b) => /^ask ai$/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim()));
    return all.find((b) => { const r = rect(b); return r.width > 4 && r.height > 4 && (r.x + r.width) <= window.innerWidth + 8; })
      || all.find((b) => { const r = rect(b); return r.width > 4 && r.height > 4; })
      || null;
  }
  function textarea() {
    // Placeholder swaps by panel state ("Ask a question..." vs
    // "What would you like to know?") — match the set, never one string.
    return [...document.querySelectorAll('textarea')]
      .find((t) => /what would you like to know|ask a question/i.test(t.placeholder || '')) || null;
  }
  function submitBtn() {
    const ta = textarea();
    let scope = ta;
    for (let i = 0; i < 8 && scope; i++) {
      scope = scope.parentElement;
      if (!scope) break;
      const hit = [...scope.querySelectorAll('button')]
        .find((b) => /^submit$/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim()));
      if (hit) return hit;
    }
    return [...document.querySelectorAll('button')]
      .find((b) => /^submit$/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim())) || null;
  }
  function clearBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => /clear chat/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim())) || null;
  }
  function closeBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => /close chat/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim())) || null;
  }
  function panelOpen() {
    const ta = textarea();
    if (!ta) return false;
    return onScreen(ta);
  }
  async function ensureOpen() {
    if (panelOpen()) return true;
    const trg = askButton();
    if (!trg) throw new Error('Ask AI trigger not displayed');
    trg.click();
    for (let i = 0; i < 20; i++) { await sleep(250); if (panelOpen()) return false; }
    throw new Error('Ask AI clicked but panel did not open');
  }
  function transcriptScope() {
    // Scope to the panel's ASIDE: document-wide reads hit stale page
    // text and ghosts (2026-09-15: body read showed a dead chat-sdk
    // answer inside vercel.com; clear/close reported false failures).
    const ta = textarea();
    if (ta) {
      let el = ta;
      for (let i = 0; i < 10 && el && el !== document.body; i++) {
        el = el.parentElement;
        if (el && el.tagName === 'ASIDE') return el;
      }
    }
    return document.body;
  }
  function readNow() {
    const scope = transcriptScope();
    const text = (scope.innerText || '').trim();
    const m = /Used (\d+) sources?/i.exec(text);
    return { text, sourcesUsed: m ? Number(m[1]) : null };
  }
  function setText(ta, message) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const setter = (proto && Object.getOwnPropertyDescriptor(proto, 'value').set) ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ta), 'value').set;
    ta.focus();
    try { document.execCommand && document.execCommand('selectAll', false, null); } catch (e) {}
    setter ? setter.call(ta, message) : (ta.value = message);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function send(message) {
    if (typeof message !== 'string' || message.trim() === '') throw new Error('message must be a non-empty string');
    await ensureOpen();
    const ta = textarea();
    if (!ta) throw new Error('panel open but composer missing');
    setText(ta, message);
    const btn = submitBtn();
    if (!btn) throw new Error('submit control not found');
    if (btn.disabled) throw new Error('submit control not armed after input');
    btn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const r = readNow();
      if (r.text.includes(message)) return { accepted: true };
    }
    throw new Error('chat submit did not register');
  }
  async function waitSettled(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);
    const TERMINAL_ERR = /error generating|check your connection|something went wrong|failed to|try again/i;
    let last = '', stable = 0;
    for (;;) {
      await sleep(1000);
      const r = readNow();
      if (TERMINAL_ERR.test(r.text)) return { settled: true, error: true, text: r.text };
      // Completion marker: the "Used N sources" line closes the turn.
      const done = r.sourcesUsed !== null && r.text.includes('Used ');
      let cand = r.text.replace(/Powered by.*$/s, '').trim();
      if (!cand) { stable = 0; }
      else if (done && cand === last) { stable++; if (stable >= 2) break; }
      else { stable = 0; last = cand; }
      if (Date.now() > deadline) return { settled: false, text: last };
    }
    return { settled: true, text: last };
  }

  let lastQ = '';
  const tools = [
    {
      name: 'vercel_chat_open',
      description: '[agent overlay — read-only] Open the vercel Ask AI panel via its trigger. Open = composer sized. No-op with already:true when open.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const already = await ensureOpen();
        return J({ visible: panelOpen(), already });
      },
    },
    {
      name: 'vercel_chat_ask',
      description: '[agent overlay] Ask the Vercel docs assistant one question and wait for the settled answer (send → wait-for-settle → read). One question per call; pass explicit timeoutMs (25000 recommended, then ask again to poll). Completion is the "Used N sources" line plus stable text — short answers settle fast, so small growth is normal. History persists until cleared — restate minimal context per task. Returns {question, answer, settled, sourcesUsed, accepted}.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['question'] },
      execute: async ({ question, timeoutMs }) => {
        if (typeof question !== 'string' || question.trim() === '') throw new Error('question must be a non-empty string');
        lastQ = question;
        await send(question);
        const res = await waitSettled(timeoutMs);
        const r = readNow();
        let ans = res.text || '';
        const qi = ans.lastIndexOf(question);
        if (qi >= 0) ans = ans.slice(qi + question.length).trim();
        if (res.error) return J({ question, answer: null, error: ans || res.text, settled: true, streaming: false });
        return J({ question, answer: ans || res.text, settled: res.settled, streaming: false, sourcesUsed: r.sourcesUsed, accepted: true });
      },
    },
    {
      name: 'vercel_chat_read',
      description: '[agent overlay — read-only] Read the latest panel transcript without sending anything. Recovery poll when ask lost its return: returns {question (last asked), answer, sourcesUsed}. Never mutates the panel.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = readNow();
        let ans = r.text || '';
        if (lastQ) {
          const qi = ans.lastIndexOf(lastQ);
          if (qi >= 0) ans = ans.slice(qi + lastQ.length).trim();
        }
        return J({ question: lastQ || null, answer: ans, sourcesUsed: r.sourcesUsed });
      },
    },
    {
      name: 'vercel_chat_clear',
      description: '[agent overlay] Wipe the panel thread via its "Clear chat" control (disabled while empty = no-op with already:true). Clears server-side — cleared turns stay gone across close+reopen. Use between unrelated tasks sharing one session. Acts-grade: call between tasks, never mid-task.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await ensureOpen();
        const btn = clearBtn();
        if (!btn || btn.disabled) return J({ cleared: true, already: true, note: 'no history to clear' });
        btn.click();
        for (let i = 0; i < 20; i++) {
          await sleep(250);
          const r = readNow();
          if (r.text.length < 300 && !/clear chat/i.test(r.text)) return J({ cleared: true, already: false });
        }
        return J({ cleared: false, note: 'clear clicked but transcript still long' });
      },
    },
    {
      name: 'vercel_chat_close',
      description: '[agent overlay — read-only] Close the Ask AI panel via its "Close chat" control. No-op with already:true when closed. Note: closing keeps history — use vercel_chat_clear to wipe the thread.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (!panelOpen()) return J({ closed: true, already: true });
        const btn = closeBtn();
        if (!btn) return J({ closed: false, note: 'no close control found' });
        btn.click();
        for (let i = 0; i < 20; i++) { await sleep(250); if (!panelOpen()) return J({ closed: true, already: false }); }
        return J({ closed: false, note: 'close clicked but panel still open' });
      },
    },
  ];

  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
