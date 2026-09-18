// agent-webmcp overlay: full panel control for Mintlify Ask Assistant.
//
// Same Mintlify panel ships on many docs sites (supermemory.ai/docs,
// exa.ai/docs, …). One pack serves all: the tool prefix follows the
// hostname. Install per host:
//   agent-webmcp tools add mintlify-chat.js --for supermemory.ai
//   agent-webmcp tools add mintlify-chat.js --for exa.ai
//
// Panel facts (inventoried live): trigger #assistant-entry (desktop) or
// #assistant-entry-mobile (≤1024px); textarea "Ask a question..." + "Send
// message" button; Close assistant panel control; suggested questions;
// data-assistant-state attribute is UNRELIABLE — verify via visible controls.
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const PREFIX = ({ 'supermemory.ai': 'supermemory', 'exa.ai': 'exa' }[location.hostname]) ||
    location.hostname.split('.')[0].replace(/[^a-z0-9]/gi, '');
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!el && el.offsetParent !== null;

  function trigger() {
    const cands = [document.querySelector('#assistant-entry'), document.querySelector('#assistant-entry-mobile')];
    return cands.find((b) => b && getComputedStyle(b).display !== 'none') || null;
  }
  function textarea() {
    const tas = [...document.querySelectorAll('textarea')].filter(vis);
    return tas.find((t) => /ask a question/i.test(t.placeholder || '')) || tas[0] || null;
  }
  function sendBtn(ta) {
    // Input and submit routinely live in DIFFERENT subtrees (Mintlify:
    // buttons sit two levels above the textarea, no shared form).
    // Ascend — never assume siblings. Match the button in ONLY its send
    // state: Mintlify swaps the send button OUT of the DOM for a separate
    // "Stop generating" element mid-stream, so a state-blind matcher
    // returns an arity lie ("Stop" ≠ haltable-here). Streaming is detected
    // by presence of the stop element, not by label on the send button.
    let el = ta;
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const hit = [...el.querySelectorAll('button')]
        .filter(vis)
        .find((b) => /^send message$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
      if (hit) return hit;
    }
    return null;
  }
  function stopBtn() {
    return [...document.querySelectorAll('button')]
      .filter(vis)
      .find((b) => /stop generating/i.test(b.getAttribute('aria-label') || b.innerText || '')) || null;
  }
  function streamingNow() {
    return !!stopBtn();
  }
  function transcriptScope() {
    // The transcript is the panel root: first ancestor of the input whose
    // text carries panel markers (close control, suggestions, assistant
    // heading). Never the input's immediate subtree — answers render
    // above/beside it, and input-adjacent scoping reads an empty counter.
    const ta = textarea();
    if (ta) {
      let el = ta;
      for (let i = 0; i < 12 && el; i++) {
        el = el.parentElement;
        if (!el || el === document.body) break;
        if (/close assistant|suggestions|\bassistant\b/i.test(el.innerText || '')) return el;
      }
    }
    const ta2 = ta;
    if (ta2) {
      let el = ta2, best = document.body;
      for (let i = 0; i < 10 && el && el !== document.body; i++) { el = el.parentElement; if (el && (el.innerText || '').length > 300) best = el; }
      return best;
    }
    return document.body;
  }
  function readNow() {
    const scope = transcriptScope();
    const text = (scope.innerText || '').trim();
    const streaming = streamingNow();
    const m = /Used (\d+) sources?|(\d+) sources?/i.exec(text);
    return { text, streaming, sourcesUsed: m ? Number(m[1] || m[2]) : null };
  }

  async function send(message) {
    let ta = textarea();
    if (!ta) {
      const trg = trigger();
      if (!trg) throw new Error('assistant panel has no visible trigger');
      trg.click();
      for (let i = 0; i < 20; i++) { await sleep(250); ta = textarea(); if (ta) break; }
      if (!ta) throw new Error('assistant panel did not open');
    }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, message);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = sendBtn(ta);
    if (!btn) throw new Error('send control not found');
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
      await sleep(250);
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

  const P = PREFIX;
  const tools = [
    {
      name: `${P}_chat_open`,
      description: `[agent overlay — read-only] Open the docs Ask Assistant panel (desktop or mobile trigger, whichever is displayed). No-op when the input is already visible. State attributes are unreliable; visibility is verified.`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (textarea()) return J({ visible: true, already: true });
        const trg = trigger();
        if (!trg) throw new Error('no assistant trigger displayed');
        trg.click();
        for (let i = 0; i < 20; i++) { await sleep(250); if (textarea()) return J({ visible: true, already: false }); }
        throw new Error('panel did not open');
      },
    },
    {
      name: `${P}_chat_close`,
      description: `[agent overlay — read-only] Close the Ask Assistant panel. Use at task end; reopening starts from the panel's own persisted state.`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const btn = [...document.querySelectorAll('button')].find((b) => /close assistant/i.test(b.getAttribute('aria-label') || b.innerText || ''));
        if (!btn) return J({ closed: false, note: 'no close control found' });
        btn.click();
        await sleep(500);
        return J({ closed: !textarea(), inputVisible: !!textarea() });
      },
    },
    {
      name: `${P}_chat_send`,
      description: `[agent overlay] Submit one message to the docs assistant. Opens the panel first if needed. Returns immediately with accepted/streaming — the return is NOT the answer; read it with ${P}_chat_read.`,
      inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      execute: async ({ message }) => J(await send(message)),
    },
    {
      name: `${P}_chat_read`,
      description: `[agent overlay — read-only] Read the assistant transcript now: current text, streaming-or-not, cited source count if shown. The verification read.`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J(readNow()),
    },
    {
      name: `${P}_chat_stop`,
      description: `[agent overlay] Halt a still-streaming answer via the panel's stop control. No-op with a note when nothing is streaming.`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const btn = stopBtn();
        if (!btn) return J({ stopped: false, reason: 'not streaming' });
        btn.click();
        await sleep(500);
        return J({ stopped: !streamingNow() });
      },
    },
    {
      name: `${P}_chat_clear`,
      description: `[agent overlay] Start a fresh conversation (Clear chat history control). Call at task start; without it, prior history contaminates this task. Errors plainly when no reset control exists — then history persistence must be reported, never assumed away.`,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const btn = [...document.querySelectorAll('button')].find((b) => vis(b) && /clear chat/i.test(b.getAttribute('aria-label') || b.innerText || ''));
        if (!btn) throw new Error('no Clear chat control — history may persist across tasks');
        btn.click();
        await sleep(750);
        return J({ cleared: true });
      },
    },
    {
      name: `ask_${P}_docs`,
      description: `[agent overlay — read-only] Ask the docs assistant one question and wait for the settled answer. Convenience over ${P}_chat_send + ${P}_chat_read. One question per call; history carries across calls within the open panel.`,
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['question'] },
      execute: async ({ question, timeoutMs }) => {
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
