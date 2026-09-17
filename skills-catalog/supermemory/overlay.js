// agent-webmcp overlay for supermemory.ai/docs: Ask Assistant panel verbs.
// Built 2026-09-15 from raw scan/act turns, same Mintlify panel family as
// the mintlify skill. Three verbs: open, ask, close.
//
// Grounded panel facts (supermemory.ai/docs, headful Chrome):
// - HEADFUL REQUIRED (family trait: headless sends echo but answers never
//   stream — proven on mintlify; supermemory verified headful only).
// - Trigger: BUTTON#assistant-entry (desktop, visible) /
//   #assistant-entry-mobile. Label "Toggle assistant panel" open and
//   closed — gate open-state on geometry, never the label.
// - Composer TEXTAREA#chat-assistant-textarea ("Ask a question...") exists
//   while closed. Open = sheet sized + composer sized + Send/Stop present.
// - Send: /^send message$/i button, disabled until text lands via native
//   setter + input event. Streaming = "Stop generating" present.
// - Transcript: DIV#chat-assistant-sheet. Turns echo the question; answers
//   carry a "Read N files" line plus source links.
// - Close via the trigger toggle. Clear: "Clear chat history" button,
//   present only while history exists — clears server-side (verified:
//   cleared turns stay gone across close+reopen). Absent on a fresh
//   panel, where clear is a no-op.
// - Natives: open_skill (verified), search_docs (500s — use the panel).
// - API-first lead (trace dump 2026-09-15): POST
//   https://leaves.mintlify.com/api/assistant/supermemory/message
//   (200, 9KB, ~6.8s). Same backend as mintlify, tenant in path. Unproven
//   as a direct substitute.
// Install: agent-webmcp tools add overlay.js --for supermemory.ai
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = (el) => { try { return el.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0 }; } };

  function trigger() {
    const cands = [document.querySelector('#assistant-entry'), document.querySelector('#assistant-entry-mobile')];
    return cands.find((b) => b && getComputedStyle(b).display !== 'none') || null;
  }
  function sheet() { return document.querySelector('#chat-assistant-sheet'); }
  function textarea() {
    return document.querySelector('textarea#chat-assistant-textarea') ||
      [...document.querySelectorAll('textarea')].find((t) => /ask a question/i.test(t.placeholder || '')) || null;
  }
  function sendBtn() {
    const ta = textarea();
    let scope = ta;
    for (let i = 0; i < 8 && scope; i++) {
      scope = scope.parentElement;
      if (!scope) break;
      const hit = [...scope.querySelectorAll('button')]
        .find((b) => /^send message$/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim()));
      if (hit) return hit;
    }
    return [...document.querySelectorAll('button')]
      .find((b) => /^send message$/i.test(((b.getAttribute('aria-label') || b.innerText) || '').trim())) || null;
  }
  function stopBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => /stop generating/i.test(b.getAttribute('aria-label') || b.innerText || '')) || null;
  }
  function streamingNow() { return !!stopBtn(); }
  function panelOpen() {
    const sh = sheet();
    if (!sh) return false;
    const r = rect(sh);
    if (r.width < 100 || r.height < 100) return false;
    const ta = textarea();
    if (!ta) return false;
    const tr = rect(ta);
    if (tr.width < 100) return false;
    return !!sendBtn() || streamingNow();
  }
  async function ensureOpen() {
    if (panelOpen()) return true;
    const trg = trigger();
    if (!trg) throw new Error('assistant panel closed and no trigger displayed');
    trg.click();
    for (let i = 0; i < 20; i++) { await sleep(250); if (panelOpen()) return false; }
    throw new Error('trigger clicked but panel did not open (headless sessions stall — use --headed)');
  }
  function readNow() {
    const sh = sheet();
    const scope = sh || document.body;
    const text = (scope.innerText || '').trim();
    const streaming = streamingNow();
    const m = /Read (\d+) files?|Used (\d+) sources?|(\d+) sources?/i.exec(text);
    return { text, streaming, sourcesUsed: m ? Number(m[1] || m[2] || m[3]) : null };
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
    if (!ta) throw new Error('assistant panel open but composer missing');
    setText(ta, message);
    const btn = sendBtn();
    if (!btn) throw new Error('send control not found (panel may be streaming a prior turn — wait, then retry)');
    if (btn.disabled) throw new Error('send control not armed after input');
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
      name: 'supermemory_chat_open',
      description: '[agent overlay — read-only] Open the supermemory Ask Assistant panel (desktop or mobile trigger, whichever is displayed). Open = sheet sized + composer sized + Send/Stop present. Headful session required. No-op with already:true when open.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const already = await ensureOpen();
        return J({ visible: panelOpen(), already });
      },
    },
    {
      name: 'supermemory_chat_close',
      description: '[agent overlay — read-only] Close the Ask Assistant panel via its toggle. No-op with already:true when closed. Note: closing keeps history — use supermemory_chat_clear to wipe the thread.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (!panelOpen()) return J({ closed: true, already: true });
        const trg = trigger();
        if (!trg) return J({ closed: false, note: 'no trigger displayed' });
        trg.click();
        for (let i = 0; i < 20; i++) { await sleep(250); if (!panelOpen()) return J({ closed: true, already: false }); }
        return J({ closed: false, note: 'toggle clicked but panel still open' });
      },
    },
    {
      name: 'supermemory_chat_clear',
      description: '[agent overlay] Wipe the panel thread via its "Clear chat history" control (present only while history exists; no-op with already:true on a fresh panel). Clears server-side — cleared turns stay gone across close+reopen. Use between unrelated tasks sharing one session.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await ensureOpen();
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
      name: 'supermemory_chat_ask',
      description: '[agent overlay] Ask the supermemory docs assistant one question and wait for the settled answer. Headful session required. One question per call; pass explicit timeoutMs (25000 recommended, then ask again to poll). History persists — restate minimal context per task. Returns {question, answer, settled, streaming, sourcesUsed}; settled:false means timed out, not unanswered — ask again.',
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
      name: 'supermemory_chat_read',
      description: '[agent overlay — read-only] Read the latest panel transcript without sending anything. Recovery poll when ask lost its return to a frame navigation: returns {question (last asked), answer, streaming}. Never mutates the panel.',
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
  ];

  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
