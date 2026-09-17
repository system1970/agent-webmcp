// agent-webmcp overlay for docs.typesafe.ai: Ask Assistant panel verbs.
// Grounded 2026-09-17 live on /introduction/quickstart (headful).
// Panel facts:
// - Trigger: BUTTON "Ask Assistant" / "Toggle assistant panel" (aria-label).
//   Panel root: DIV.chat-assistant-sheet (368px open, 0px closed).
//   Composer TEXTAREA "Ask a question..." persists sized while closed —
//   NEVER gate open-state on it; gate on sheet width.
// - Send: "Send message" (disabled until text lands via native setter +
//   input event). Transcript scope: the sheet (NOT document.body — body
//   reads hit full docs text and ghosts).
// - NO clear control exists on this panel (no menu, no button, history or
//   not) — clear is an honest no-op. Close: "Close assistant panel".
// - Natives on this tenant: open_skill (verified), search_docs (500s from
//   here — route around via the panel).
// - Settle: stable text twice; answers end with source links, no
//   "Used N sources" line (sourcesUsed stays null — reported, not faked).
// Install: agent-webmcp tools add overlay.js --for docs.typesafe.ai
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rect = (el) => { try { return el.getBoundingClientRect(); } catch (e) { return { width: 0, height: 0 }; } };
  const norm = (b) => (((b.getAttribute && b.getAttribute('aria-label')) || b.innerText) || '').trim();

  function sheet() { return document.querySelector('.chat-assistant-sheet'); }
  function panelOpen() {
    const sh = sheet();
    if (!sh) return false;
    return rect(sh).width > 100;
  }
  function trigger() {
    const all = [...document.querySelectorAll('button')]
      .filter((b) => /ask assistant|toggle assistant panel/i.test(norm(b)));
    return all.find((b) => { const r = rect(b); return r.width > 4 && r.height > 4; }) || null;
  }
  function textarea() {
    return [...document.querySelectorAll('textarea')]
      .find((t) => /ask a question/i.test(t.placeholder || '')) || null;
  }
  function sendBtn() {
    const ta = textarea();
    let scope = ta;
    for (let i = 0; i < 8 && scope; i++) {
      scope = scope.parentElement;
      if (!scope) break;
      const hit = [...scope.querySelectorAll('button')]
        .find((b) => /^send message$/i.test(norm(b)));
      if (hit) return hit;
    }
    return [...document.querySelectorAll('button')]
      .find((b) => /^send message$/i.test(norm(b))) || null;
  }
  function stopBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => /stop generating|cancel/i.test(norm(b))) || null;
  }
  function closeBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => /close assistant/i.test(norm(b))) || null;
  }
  async function ensureOpen() {
    if (panelOpen()) return true;
    const trg = trigger();
    if (!trg) throw new Error('assistant panel closed and no trigger displayed');
    trg.click();
    for (let i = 0; i < 20; i++) { await sleep(250); if (panelOpen()) return false; }
    throw new Error('trigger clicked but panel did not open');
  }
  function readNow() {
    const scope = sheet() || document.body;
    const text = (scope.innerText || '').trim();
    const m = /Used (\d+) sources?/i.exec(text);
    return { text, streaming: !!stopBtn(), sourcesUsed: m ? Number(m[1]) : null };
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
    const btn = sendBtn();
    if (!btn) throw new Error('send control not found');
    if (btn.disabled) throw new Error('send control not armed after input');
    btn.click();
    // No echo-confirm loop: a subframe on this tenant navigates every few
    // seconds and any held execution dies with "cross-origin navigation".
    // The click either registers (poll read) or it doesn't (ask again).
    return { accepted: true };
  }

  const tools = [
    {
      name: 'typesafe_chat_open',
      description: '[agent overlay — read-only] Open the TypeSafe Ask Assistant panel. Open = .chat-assistant-sheet wider than 100px (the composer exists while closed — its presence is not the signal). No-op with already:true when open.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const already = await ensureOpen();
        return J({ visible: panelOpen(), already });
      },
    },
    {
      name: 'typesafe_chat_ask',
      description: '[agent overlay] Send one question to the TypeSafe docs assistant. Returns immediately after the send registers ({question, accepted:true}) — ALWAYS follow with typesafe_chat_read polls until the answer stops growing. (This tenant navigates a subframe mid-execution, so no ask call can hold for the answer.)',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, timeoutMs: { type: 'number' } }, required: ['question'] },
      execute: async ({ question }) => {
        if (typeof question !== 'string' || question.trim() === '') throw new Error('question must be a non-empty string');
        await send(question);
        return J({ question, accepted: true, note: 'poll typesafe_chat_read for the answer' });
      },
    },
    {
      name: 'typesafe_chat_read',
      description: '[agent overlay — read-only] Read the latest panel transcript without sending anything. Recovery poll when ask lost its return. Never mutates the panel.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J({ answer: readNow().text }),
    },
    {
      name: 'typesafe_chat_clear',
      description: '[agent overlay] No-op: this panel exposes no clear control (verified live — no button or menu for it, with or without history). Returns already:true. Use a fresh session per unrelated task instead.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J({ cleared: true, already: true, note: 'no clear control on this panel' }),
    },
    {
      name: 'typesafe_chat_close',
      description: '[agent overlay — read-only] Close the Ask Assistant panel via "Close assistant panel". No-op with already:true when closed.',
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
