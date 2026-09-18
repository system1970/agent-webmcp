// agent-webmcp overlay: full panel control for shopify.dev's docs assistant.
//
// shopify.dev exposes no native WebMCP tools. Its assistant (Ask assistant
// trigger → textarea "What would you like to know?" in a FORM, Submit
// prompt button, New chat + Chat history + Close Assistant controls,
// open-state in localStorage DevAssistant.isOpen) is mirrored verb-for-verb.
//
// Install: agent-webmcp tools add shopify-chat.js --for shopify.dev
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const P = 'shopify';
  const PACKV = 'v3-ranked-scope';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vis = (el) => !!el && el.offsetParent !== null;
  const label = (b) => ((b.getAttribute('aria-label') || b.innerText || '').trim());

  function trigger() {
    return [...document.querySelectorAll('button,a,[role=button]')]
      .find((b) => vis(b) && /ask assistant/i.test(label(b))) || null;
  }
  function textarea() {
    const tas = [...document.querySelectorAll('textarea')].filter(vis);
    return tas.find((t) => /what would you like/i.test(t.placeholder || '')) || tas[0] || null;
  }
  function sendBtn() {
    return [...document.querySelectorAll('button')].filter(vis)
      .find((b) => /^submit prompt$/i.test(label(b))) || null;
  }
  function stopBtn() {
    return [...document.querySelectorAll('button')].filter(vis)
      .find((b) => /stop generating|^\s*stop\s*$/i.test(label(b))) || null;
  }
  function streamingNow() { return !!stopBtn(); }
  function clearBtn() {
    return [...document.querySelectorAll('button')].filter(vis)
      .find((b) => /^new chat$/i.test(label(b))) || null;
  }
  function closeBtn() {
    return [...document.querySelectorAll('button')].filter(vis)
      .find((b) => /close assistant/i.test(label(b))) || null;
  }
  function historyBtn() {
    return [...document.querySelectorAll('button')].filter(vis)
      .find((b) => /chat history/i.test(label(b))) || null;
  }
  function transcriptScope() {
    // Transcript and input live in SEPARATE subtrees (Shopify: the input
    // FORM holds 13ch while the answer renders in the sibling _ChatView/
    // _ScrollArea panel). Anchor on the panel: prefer the chat container,
    // else the widest body child holding long text — never the input's
    // own ancestors. When several containers share class fragments, rank
    // by text length — the first match is routinely a suggestions
    // scroller, not the transcript.
    const cands = [...document.querySelectorAll('div[class*=ChatView], div[class*=ChatBot], div[class*=ChatBotContent], div[class*=ScrollArea]')];
    if (cands.length) {
      cands.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length);
      return cands[0];
    }
    let best = document.body, bestLen = 0;
    for (const kid of document.body.children) {
      const len = (kid.innerText || '').length;
      if (len > bestLen && len > 100) { best = kid; bestLen = len; }
    }
    return best;
  }
  function readNow() {
    if (!textarea()) return { text: '', streaming: false, sourcesUsed: null, panelClosed: true };
    const scope = transcriptScope();
    const text = (scope.innerText || '').trim();
    const m = /Used (\d+) sources?|(\d+) sources?|References/i.exec(text);
    return { text, streaming: streamingNow(), sourcesUsed: m && /\d/.test(m[0]) ? Number((m[1] || m[2])) : null };
  }
  async function ensureOpen() {
    if (textarea()) return false;
    const trg = trigger();
    if (!trg) throw new Error('no Ask assistant trigger displayed');
    trg.click();
    for (let i = 0; i < 20; i++) { await sleep(250); if (textarea()) return true; }
    throw new Error('assistant panel did not open');
  }
  async function send(message) {
    await ensureOpen();
    const ta = textarea();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, message);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = sendBtn();
    if (!btn) throw new Error('Submit prompt control not found');
    btn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (streamingNow()) return { accepted: true, streaming: true };
      if (readNow().text.includes(message)) return { accepted: true, streaming: streamingNow() };
    }
    throw new Error('chat submit did not register');
  }
  async function waitSettled(timeoutMs, question) {
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
      // Never settle on panel chrome: the transcript must echo the question
      // AND carry substance beyond it. Right after New chat the containers
      // are empty and the longest candidate can be a 13ch button label.
      const substantial = !question || (cand.includes(question) && cand.length > question.length + 50);
      if (!cand || r.streaming || !substantial) { stable = 0; if (cand) last = cand; }
      else if (cand === last) { stable++; if (stable >= 2) break; }
      else { stable = 0; last = cand; }
      if (Date.now() > deadline) return { settled: false, text: last };
    }
    return { settled: true, text: last };
  }

  const tools = [
    { name: `${P}_chat_open`, description: `[agent overlay — read-only] Open the shopify.dev assistant (Ask assistant trigger). No-op when the input is already visible.`, inputSchema: { type: 'object', properties: {} },
      execute: async () => { const opened = await ensureOpen(); return J({ visible: true, already: !opened }); } },
    { name: `${P}_chat_close`, description: `[agent overlay — read-only] Close the assistant panel. Transcript persists per open-state; use ${P}_chat_clear for a fresh task.`, inputSchema: { type: 'object', properties: {} },
      execute: async () => { const btn = closeBtn(); if (!btn) return J({ closed: false, note: 'no close control found' }); btn.click(); await sleep(500); return J({ closed: !textarea() }); } },
    { name: `${P}_chat_send`, description: `[agent overlay] Submit one message to the shopify.dev assistant. Returns immediately with accepted/streaming — the return is NOT the answer; read it with ${P}_chat_read.`, inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      execute: async ({ message }) => J(await send(message)) },
    { name: `${P}_chat_read`, description: `[agent overlay — read-only] Read the assistant transcript now: current text, streaming-or-not. The verification read.`, inputSchema: { type: 'object', properties: {} },
      execute: async () => J(readNow()) },
    { name: `${P}_chat_stop`, description: `[agent overlay] Halt a still-streaming answer via the panel stop control. No-op with a note when nothing is streaming.`, inputSchema: { type: 'object', properties: {} },
      execute: async () => { const btn = stopBtn(); if (!btn) return J({ stopped: false, reason: 'not streaming' }); btn.click(); await sleep(500); return J({ stopped: !streamingNow() }); } },
    { name: `${P}_chat_clear`, description: `[agent overlay] Start a fresh conversation (New chat). Call at task start; without it prior history contaminates this task.`, inputSchema: { type: 'object', properties: {} },
      execute: async () => { await ensureOpen(); const btn = clearBtn(); if (!btn) throw new Error('no New chat control — history may persist'); btn.click(); await sleep(750); return J({ cleared: true }); } },
    { name: `${P}_chat_history`, description: `[agent overlay — read-only] Open the Chat history list and return its entries (titles/order as shown). Read-only; does not switch conversations.`, inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await ensureOpen();
        const btn = historyBtn();
        if (!btn) throw new Error('no Chat history control');
        btn.click();
        await sleep(750);
        // Scope to the history container — page-wide grabs drown in nav.
        let root = btn.closest('[role=dialog], [role=menu], [role=listbox]');
        if (!root) {
          let el = btn;
          for (let i = 0; i < 6 && el; i++) {
            el = el.parentElement;
            if (!el) break;
            const kids = [...el.querySelectorAll('button,a,[role=option]')].filter(vis);
            if (kids.length >= 3) { root = el; break; }
          }
        }
        root = root || document;
        const items = [...root.querySelectorAll('button,a,[role=option],li')].filter(vis)
          .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 120).slice(0, 20);
        return J({ entries: items });
      } },
    { name: `ask_${P}_docs`, description: `[agent overlay — read-only] Ask the shopify.dev assistant one question (pack v3-ranked-scope) and wait for the settled answer. Convenience over ${P}_chat_send + ${P}_chat_read. Call ${P}_chat_clear first for a fresh task.`, inputSchema: { type: 'object', properties: { question: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['question'] },
      execute: async ({ question, timeoutMs }) => {
        await send(question);
        const res = await waitSettled(timeoutMs, question);
        const r = readNow();
        let ans = res.text || '';
        const qi = ans.lastIndexOf(question);
        if (qi >= 0) ans = ans.slice(qi + question.length).trim();
        // Strip trailing panel chrome (input-area button text, feedback
        // prompts) — the scope container includes the prompt area.
        ans = ans.replace(/\n*Was this answer useful\?\s*Yes\s*No\s*/i, '\n').replace(/\n*Submit prompt\s*$/i, '').trim();
        if (res.error) return J({ question, answer: null, error: ans || res.text, settled: true });
        return J({ question, answer: ans || res.text, settled: res.settled, streaming: r.streaming, sourcesUsed: r.sourcesUsed });
      } },
  ];
  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
