// agent-webmcp overlay for mintlify.com/docs: Ask Assistant panel verbs.
// Rebuilt 2026-09-15 from raw scan/act turns (no hand-written JS in the
// turns themselves). Three verbs: open, ask, close.
//
// Grounded panel facts (mintlify.com/docs, headful Chrome):
// - HEADFUL REQUIRED. Headless accepts the send (question echoes) but the
//   answer never streams (30s zero growth, Stop present, sheet holds only
//   the echo). Headed answers render in ~8-10s with cited sources.
// - Trigger: BUTTON#assistant-entry (desktop) / #assistant-entry-mobile;
//   only the displayed one works. Label is "Toggle assistant panel"
//   (identical open and closed) — never gate open-state on the label;
//   gate on geometry below.
// - Composer TEXTAREA#chat-assistant-textarea ("Ask a question...") EXISTS
//   while closed — textarea presence is NOT an open signal. Open = sheet
//   has size AND textarea has size AND (Send armed or Stop present).
// - Send: button matching /^send message$/i on aria-label or text,
//   disabled until text lands (native setter + input event, then click).
//   Panel swaps send OUT for "Stop generating" while streaming —
//   streaming = Stop present, never a label flip on a cached node.
// - Transcript root: DIV#chat-assistant-sheet. Turns echo the question
//   first; answers end with cited source links.
// - Close: [aria-label="Close assistant panel"] or the entry toggle.
//   Clear: "Clear chat history" button, present only while history
//   exists — clears server-side (cleared turns stay gone across
//   close+reopen). Absent on a fresh panel, where clear is a no-op.
// - Natives (no overlay needed): open_skill (verified), search_docs
//   (500s from here — route around via the panel).
// - API-first lead (trace dump 2026-09-15): POST
//   https://leaves.mintlify.com/api/assistant/mintlify/message
//   (200, ~4.7s) carries the turn — candidate direct substitute, unproven.
// Install: agent-webmcp tools add overlay.js --for mintlify.com
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
    // Input and submit live in different subtrees — ascend from the textarea.
    // Match ONLY the send state; a Stop-means-streaming matcher belongs in stopBtn().
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
  function transcriptScope() {
    const sh = sheet();
    if (sh) return sh;
    return document.body;
  }
  function readNow() {
    const scope = transcriptScope();
    const text = (scope.innerText || '').trim();
    const streaming = streamingNow();
    const m = /Used (\d+) sources?|(\d+) sources?/i.exec(text);
    return { text, streaming, sourcesUsed: m ? Number(m[1] || m[2]) : null };
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

  const tools = [
    {
      name: 'mintlify_chat_open',
      description: '[agent overlay — read-only] Open the Mintlify Ask Assistant panel (desktop or mobile trigger, whichever is displayed). Open = sheet sized + composer sized + Send/Stop present; the composer exists while closed so its presence alone is not the signal. Headful session required (headless stalls). No-op with already:true when open.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const already = await ensureOpen();
        return J({ visible: panelOpen(), already });
      },
    },
    {
      name: 'mintlify_chat_close',
      description: '[agent overlay — read-only] Close the Ask Assistant panel via its toggle. No-op with already:true when closed. Note: closing keeps history — use mintlify_chat_clear to wipe the thread.',
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
      name: 'mintlify_chat_clear',
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
      name: 'mintlify_chat_ask',
      description: '[agent overlay] Ask the Mintlify docs assistant one question and wait for the settled answer (send → wait-for-settle → read). Headful session required. One question per call; pass explicit timeoutMs (25000 recommended, then ask again to poll — each call returns the latest settled state). History persists across calls — restate minimal context per task. Returns {question, answer, settled, streaming, sourcesUsed}; settled:false means the wait timed out, not that no answer exists — ask again.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['question'] },
      execute: async ({ question, timeoutMs }) => {
        if (typeof question !== 'string' || question.trim() === '') throw new Error('question must be a non-empty string');
        await send(question);
        const res = await waitSettled(timeoutMs);
        const r = readNow();
        let ans = res.text || '';
        const qi = ans.lastIndexOf(question);
        if (qi >= 0) ans = ans.slice(qi + question.length).trim();
        if (res.error) return J({ question, answer: null, error: ans || res.text, settled: true, streaming: false });
        return J({ question, answer: ans || res.text, settled: res.settled, streaming: r.streaming, sourcesUsed: r.sourcesUsed });
      },
    },
  ];

  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
