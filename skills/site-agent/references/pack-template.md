# site-agent-pack — five-tool pack template

Copy, fill the `SITE` block, delete what the panel lacks. Pack contract: async IIFE, registers via the page's own `document.modelContext`, returns `ok:<tool>` / `fail:<tool>:<reason>` lines. Shell: `agent-webmcp tools add ./<site>.js --for <host>`.

```js
// agent-webmcp overlay: <site> Ask-AI panel.
// GATE: <aria|dom> (observed <date>; values quoted in notes).
// Install: agent-webmcp tools add packs/<site>.js --for <host>
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

  // ---- SITE: fill from probes ----
  const SEL = {
    textarea: 'textarea[name=message]',
    submit: 'button[type=submit]',
    panel: 'aside',                 // textarea.closest(...) scope for reads
    userTurn: 'div.is-user',
    asstTurn: 'div.is-assistant',
    prose: 'div.is-assistant div.space-y-4',
    shimmer: /^(Thinking|Searching|Running|Working|Reading)\b/i,
    openTrigger: 'button:has-text("Ask AI")', // resolve by hand per site
    expand: 'button[aria-label="Expand chat"]',
    collapse: 'button[aria-label="Collapse chat"]',
    clear: 'button[aria-label="Clear chat"]',
    close: 'button[aria-label="Close chat"]',
  };
  const IDLE_ARIA = 'Submit', BUSY_ARIA = 'Stop'; // BUSY_ARIA=null when DOM gate
  // ---------------------------------

  function nodes() {
    const ta = document.querySelector(SEL.textarea);
    if (!ta || !ta.form) return null;
    const btn = ta.form.querySelector(SEL.submit);
    const panel = ta.closest('aside, [role=dialog]') || document.body;
    if (!btn) return null;
    return { ta, btn, panel };
  }
  const isStreaming = (n) => BUSY_ARIA &&
    new RegExp(BUSY_ARIA, 'i').test(n.btn.getAttribute('aria-label') || '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function readState() {
    const n = nodes();
    if (!n) return { panelFound: false };
    const text = n.panel.innerText || '';
    const users = n.panel.querySelectorAll(SEL.userTurn).length;
    const proseEl = [...n.panel.querySelectorAll(SEL.asstTurn)].pop()
      ?.querySelector(':scope div.space-y-4, :scope [class*=prose]');
    return {
      panelFound: true,
      panelOpen: n.panel.closest('[data-state]')?.getAttribute('data-state') !== 'closed',
      submitAria: n.btn.getAttribute('aria-label'),
      submitDisabled: !!n.btn.disabled,
      nUser: users,
      nAsst: n.panel.querySelectorAll(SEL.asstTurn).length,
      streaming: isStreaming(n) || SEL.shimmer.test(
        (text.match(/.*(Thinking|Searching|Running|Working|Reading).*/)?.[0] || '').trim()),
      lastAnswerChars: (proseEl?.innerText || '').length,
    };
  }

  function extract(n) {
    const turns = [...n.panel.querySelectorAll(SEL.asstTurn)];
    const prose = turns.pop()?.querySelector(':scope div.space-y-4, :scope [class*=prose]');
    if (prose?.innerText?.trim()) return prose.innerText.trim(); // scoped: no chrome
    return n.panel.innerText // fallback: strip chrome
      .replace(/^Chat\s*/, '').replace(/\d+\s*\/\s*1000\s*$/, '')
      .replace(/Powered by.*$/s, '').replace(SEL.shimmer, '').trim();
  }

  async function waitDone(n, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);
    let last = '', stable = 0;
    for (;;) {
      await sleep(500); // detection lag ~0.5-1s; never settle while streaming
      const streaming = isStreaming(n);
      const cand = extract(n);
      if (!cand || streaming) { stable = 0; if (cand) last = cand; }
      else if (cand === last) { if (++stable >= 2) break; }
      else { stable = 0; last = cand; }
      if (Date.now() > deadline) return { answer: last, timedOut: true };
    }
    return { answer: last, timedOut: false };
  }

  async function ask(question, timeoutMs) {
    const n = nodes();
    if (!n) throw new Error('chat panel not found on this page');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(n.ta, ''); n.ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(n.ta, question); n.ta.dispatchEvent(new Event('input', { bubbles: true }));
    n.btn.click();
    let seen = false; // submit landed: stream signal or question echo (10s)
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (isStreaming(n) || (n.panel.innerText || '').includes(question)) { seen = true; break; }
    }
    if (!seen) throw new Error('chat submit did not register (no stream start)');
    const { answer, timedOut } = await waitDone(n, timeoutMs);
    if (!answer) throw new Error('agent did not answer within timeout');
    const m = /Used (\d+) sources?/.exec(answer);
    return { question, answer: timedOut ? answer + ' [stream still open at timeout]' : answer,
      sourcesUsed: m ? Number(m[1]) : null };
  }

  const TOOLS = [
    { name: 'PREFIX_open', description: '[agent overlay] Open the <site> Ask-AI panel. Reversible.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        // click SEL.openTrigger (fallback hotkey), assert open; return readState()
        const n0 = nodes();
        const t = [...document.querySelectorAll('button')].find(b => /ask ai/i.test(b.innerText || ''));
        if (t) t.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', metaKey: true, bubbles: true }));
        await sleep(800); return J(readState());
      } },
    { name: 'PREFIX_ask', description: '[agent overlay — read-only] Ask the <site> agent one question; returns its answer text. Consumes demo inference, changes nothing.',
      inputSchema: { type: 'object', properties: {
          question: { type: 'string', description: 'One specific question per call' },
          timeoutMs: { type: 'number', description: 'Max wait (default 90000)' } },
        required: ['question'] },
      execute: async ({ question, timeoutMs }) => J(await ask(question, timeoutMs)) },
    { name: 'PREFIX_state', description: '[agent overlay — read-only] Panel state: open, turns, streaming flag, submit aria, last-answer size.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J(readState()) },
    { name: 'PREFIX_fullscreen', description: '[agent overlay] Toggle the <site> chat fullscreen (Expand/Collapse). Reversible.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const b = document.querySelector(SEL.expand) || document.querySelector(SEL.collapse);
        if (!b) throw new Error('fullscreen control not found');
        b.click(); await sleep(800); return J(readState());
      } },
    { name: 'PREFIX_clear', description: '[agent overlay] Clear the <site> chat (new session). Restores starter state.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const b = document.querySelector(SEL.clear);
        if (!b) throw new Error('clear control not found');
        b.click(); await sleep(800); return J(readState());
      } },
  ];

  for (const t of TOOLS) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
```

Checklist before `tools add`: `PREFIX_` replaced, `SEL` selectors quoted from probes, `GATE` header filled, `BUSY_ARIA=null` when DOM gate (drop the `stop` tool — none exists), starter/chrome strings verified in extraction fallback.
