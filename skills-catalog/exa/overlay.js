// agent-webmcp overlay for exa.ai/docs: Ask Assistant panel verbs.
// Built 2026-09-16 from raw scan/act turns (headful Chrome). Verbs:
// open, ask, read, clear, close. Mintlify backend family
// (leaves.mintlify.com) with a triggerless entry: no visible open
// button — the panel opens on the first inline send.
//
// Grounded panel facts (exa.ai/docs, headful):
// - HEADFUL REQUIRED (family trait: headless sends echo but answers
//   never stream).
// - NO visible trigger (both #assistant-entry variants hidden). Entry
//   is the inline INPUT bar (type=text, "Ask a question...", bottom of
//   the page). First send through it opens the panel AND submits.
// - ARMING IS THE HARD PART. The inline send stays disabled until
//   React accepts the text. Recipe (verified 2x live): bar must be
//   EMPTY first, then focus + native HTMLInputElement setter + input
//   event + change event. Typing into a non-empty bar, or setter
//   without change, leaves the send disabled. Same recipe with the
//   HTMLTextAreaElement setter for the panel composer.
// - Panel composer TEXTAREA#chat-assistant-textarea ("Ask a
//   question...") lives off-canvas while closed — gate open-state on
//   the SHEET's viewport geometry (vercel lesson), never on composer
//   size or placeholder.
// - Send: /^send message$/i button; inline-bar send sits beside the
//   bar, panel send beside the composer. Disabled until text lands.
//   Streaming = "Stop generating" present.
// - Transcript: DIV#chat-assistant-sheet. Turns echo the question;
//   answers carry a "Read N files" line plus source links.
// - Close: "Close assistant panel". Clear: "Clear chat history"
//   (present only with history) — SERVER-SIDE here (verified
//   2026-09-16: clear+close+reopen leaves the old turn gone).
// - Natives: open_skill (verify live), search_docs (500s in
//   September — retry before trusting).
// - API-first lead (trace dump 2026-09-16): POST
//   https://leaves.mintlify.com/api/assistant/exa-52/message
//   (200, 33KB, ~10.7s) carries the turn — candidate direct
//   substitute, unproven.
// Install: agent-webmcp tools add overlay.js --for exa.ai
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = (el) => { try { return el.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0 }; } };
  const onScreen = (r) => r.width > 100 && r.height > 20 &&
    r.x > -8 && (r.x + r.width) <= window.innerWidth + 8;

  function inlineBar() {
    // The triggerless entry: bottom INPUT bar. Must be on-screen.
    const cands = [...document.querySelectorAll('input')]
      .filter((i) => i.type === 'text' && /ask a question/i.test(i.placeholder || ''));
    return cands.find((i) => { const r = rect(i); return r.width > 100 && (r.x + r.width) <= window.innerWidth + 8; })
      || null;
  }
  function sheet() { return document.querySelector('#chat-assistant-sheet'); }
  function textarea() {
    return document.querySelector('textarea#chat-assistant-textarea') ||
      [...document.querySelectorAll('textarea')].find((t) => /ask a question/i.test(t.placeholder || '')) || null;
  }
  function sendNear(el) {
    // Nearest send control ascending from a composer (bar or panel).
    let scope = el;
    for (let i = 0; i < 8 && scope; i++) {
      scope = scope.parentElement;
      if (!scope) break;
      const hit = [...scope.querySelectorAll('button')]
        .find((b) => /^send message$/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim()));
      if (hit) return hit;
    }
    return null;
  }
  function stopBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => /stop generating/i.test(b.getAttribute('aria-label') || b.innerText || '')) || null;
  }
  function streamingNow() { return !!stopBtn(); }
  function panelOpen() {
    const sh = sheet();
    if (!sh) return false;
    if (!onScreen(rect(sh))) return false;
    return !!textarea() || streamingNow();
  }
  function transcriptScope() {
    const sh = sheet();
    if (sh) return sh;
    return document.body;
  }
  function readNow() {
    const scope = transcriptScope();
    const text = (scope.innerText || '').trim();
    const streaming = streamingNow();
    const m = /Read (\d+) files?|Used (\d+) sources?|(\d+) sources?/i.exec(text);
    return { text, streaming, sourcesUsed: m ? Number(m[1] || m[2] || m[3]) : null };
  }
  function armText(el, message) {
    // The arming recipe: empty-first, focus, native setter, input+change.
    // Setter without change, or typing into a non-empty bar, leaves the
    // send disabled (verified live 2026-09-16).
    const proto = (el.tagName === 'TEXTAREA'
      ? (window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype)
      : (window.HTMLInputElement && window.HTMLInputElement.prototype));
    const setter = (proto && Object.getOwnPropertyDescriptor(proto, 'value').set) ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
    el.focus();
    try { setter.call(el, ''); } catch (e) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    try { setter.call(el, message); }
    catch (e) { el.value = message; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function send(message) {
    if (typeof message !== 'string' || message.trim() === '') throw new Error('message must be a non-empty string');
    // Prefer the inline bar when the panel is closed: its send opens
    // the panel AND submits. Fall back to the panel composer.
    let el = panelOpen() ? textarea() : (inlineBar() || textarea());
    if (!el) throw new Error('no composer available (neither inline bar nor panel composer found)');
    armText(el, message);
    const btn = sendNear(el);
    if (!btn) throw new Error('send control not found (panel may be streaming a prior turn — wait, then retry)');
    if (btn.disabled) throw new Error('send control not armed after input (arming recipe failed — report the verbatim error)');
    btn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (streamingNow()) return { accepted: true, streaming: true };
      const r = readNow();
      if (r.text.includes(message)) return { accepted: true, streaming: r.streaming };
    }
    throw new Error('chat submit did not register');
  }
  async function waitSettled(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);
    const TRANSIENT = /^(Running|Thinking|Working|Searching|Reading|Generating)\b/i;
    const TERMINAL_ERR = /error generating|check your connection|something went wrong|failed to|try again/i;
    let last = '', stable = 0;
    for (;;) {
      await sleep(1000);
      const r = readNow();
      if (TERMINAL_ERR.test(r.text)) return { settled: true, error: true, text: r.text };
      let cand = r.text.replace(/Powered by.*$/s, '').trim();
      cand = cand.split('\n').filter((l) => !TRANSIENT.test(l.trim())).join('\n').trim();
      if (!cand || r.streaming) { stable = 0; if (cand) last = cand; }
      else if (cand === last) { stable++; if (stable >= 2) break; }
      else { stable = 0; last = cand; }
      if (Date.now() > deadline) return { settled: false, text: last };
    }
    return { settled: true, text: last };
  }

  let lastQ = '';
  const tools = [
    {
      name: 'exa_chat_open',
      description: '[agent overlay — read-only] Check the Exa Ask Assistant state. Triggerless entry: no open button exists — the panel opens on the first inline send, so this verb never clicks anything. Reports {visible (sheet on-screen), barPresent (inline entry bar available)}. Headful session required.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J({ visible: panelOpen(), barPresent: !!inlineBar(), already: panelOpen() }),
    },
    {
      name: 'exa_chat_ask',
      description: '[agent overlay] Ask the Exa docs assistant one question and wait for the settled answer. First call opens the panel via the inline bar automatically. Headful session required. One question per call; pass explicit timeoutMs (25000 recommended, then ask again to poll). History persists until cleared — restate minimal context per task. Returns {question, answer, settled, streaming, sourcesUsed}; settled:false means timed out, not unanswered — ask again.',
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
        return J({ question, answer: ans || res.text, settled: res.settled, streaming: r.streaming, sourcesUsed: r.sourcesUsed, accepted: true });
      },
    },
    {
      name: 'exa_chat_read',
      description: '[agent overlay — read-only] Read the latest panel transcript without sending anything. Recovery poll when ask lost its return to a frame navigation: returns {question (last asked), answer, streaming, sourcesUsed}. Never mutates the panel.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const r = readNow();
        let ans = r.text || '';
        if (lastQ) {
          const qi = ans.lastIndexOf(lastQ);
          if (qi >= 0) ans = ans.slice(qi + lastQ.length).trim();
        }
        return J({ question: lastQ || null, answer: ans, streaming: r.streaming, sourcesUsed: r.sourcesUsed });
      },
    },
    {
      name: 'exa_chat_clear',
      description: '[agent overlay] Wipe the panel thread via its "Clear chat history" control (present only while history exists; no-op with already:true on a fresh panel). SERVER-SIDE here (verified 2026-09-16: clear+close+reopen leaves the old turn gone). Use between unrelated tasks sharing one session. Acts-grade: call between tasks, never mid-task.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (!panelOpen()) return J({ cleared: true, already: true, note: 'panel closed — send first to open it' });
        const btn = [...document.querySelectorAll('button')]
          .find((b) => /clear chat history/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim()));
        if (!btn) return J({ cleared: true, already: true, note: 'no history to clear' });
        btn.click();
        for (let i = 0; i < 20; i++) {
          await sleep(250);
          const r = readNow();
          if (!r.streaming && r.text.length < 300 && !/clear chat history/i.test(r.text)) return J({ cleared: true, already: false });
        }
        return J({ cleared: false, note: 'clear clicked but transcript still long' });
      },
    },
    {
      name: 'exa_chat_close',
      description: '[agent overlay — read-only] Close the Ask Assistant panel via its "Close assistant panel" control. No-op with already:true when closed. Note: closing keeps history — use exa_chat_clear to wipe the thread. Reopen by sending (exa_chat_ask).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (!panelOpen()) return J({ closed: true, already: true });
        const btn = [...document.querySelectorAll('button')]
          .find((b) => /close assistant panel/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim()));
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
