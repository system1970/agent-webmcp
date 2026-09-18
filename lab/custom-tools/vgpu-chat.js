// agent-webmcp overlay: full panel control for vgpu.sh's Ask AI docs agent.
//
// vgpu.sh exposes no native WebMCP tools. Its Ask AI panel (textarea +
// Submit in a form, 0/1000 counter, Clear chat control, open-state in
// localStorage) is mirrored verb-for-verb: visibility, send, read, stop,
// clear, plus ask_vgpu_docs as the composed convenience.
//
// Install: agent-webmcp tools add vgpu-chat.js --for vgpu.sh
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function textarea() {
    const tas = [...document.querySelectorAll('textarea[placeholder]')].filter((t) => t.offsetParent !== null);
    return tas[0] || null;
  }
  function byText(re) {
    return [...document.querySelectorAll('button, a')].find((b) => re.test(((b.innerText || b.getAttribute('aria-label') || '').trim())));
  }
  function submitBtn(ta) {
    if (!ta || !ta.form) return null;
    return ta.form.querySelector('button[type="submit"], button[aria-label="Submit"], button[aria-label="Stop"]');
  }
  function isStreaming(btn) {
    return !!btn && /stop/i.test(btn.getAttribute('aria-label') || '');
  }
  function scopeOf(ta) {
    // The transcript (message list) lives OUTSIDE the input's subtree —
    // anchor on it, not on the textarea's ancestors. The user messages
    // carry .is-user; the list is their nearest shared container.
    try {
      const list = document.querySelector('div:has(div.is-user)');
      if (list && list.innerText && list.innerText.trim()) return list;
    } catch (e) { /* :has unsupported — fall through */ }
    const echo = [...document.querySelectorAll('div')].find((d) =>
      [...(d.children || [])].some((c) => c.classList && c.classList.contains('is-user')));
    if (echo) return echo;
    return (ta && (ta.closest('aside, [role="dialog"], section') || ta.parentElement)) || document.body;
  }
  function readScope(ta) {
    const scope = scopeOf(ta);
    const text = (scope.innerText || '').trim();
    const btn = submitBtn(ta);
    const streaming = isStreaming(btn);
    const sources = /Used (\d+) sources?/.exec(text);
    return { text, streaming, sourcesUsed: sources ? Number(sources[1]) : null };
  }

  async function send(question) {
    const ta = textarea();
    if (!ta) throw new Error('chat input not visible — open the panel first (vgpu_chat_open)');
    const btn = submitBtn(ta);
    if (!btn) throw new Error('submit control not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, question);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    btn.click();
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const scope = scopeOf(ta);
      const text = scope.innerText || '';
      if (isStreaming(submitBtn(ta)) || text.includes(question)) return { accepted: true, streaming: isStreaming(submitBtn(ta)) };
    }
    throw new Error('chat submit did not register (no stream start, question not echoed)');
  }

  async function waitSettled(ta, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);
    const TRANSIENT = /^(Running|Thinking|Working|Searching|Reading|Generating)\b/i;
    let last = '', stable = 0;
    for (;;) {
      await sleep(250);
      const scope = scopeOf(ta);
      const btn = submitBtn(ta);
      const streaming = isStreaming(btn);
      let cand = (scope.innerText || '').replace(/Powered by.*$/s, '').replace(/\d+\s*\/\s*1000\s*$/, '').trim();
      cand = cand.split('\n').filter((l) => !TRANSIENT.test(l.trim())).join('\n').trim();
      if (!cand || streaming) { stable = 0; if (cand) last = cand; }
      else if (cand === last) { stable++; if (stable >= 2) break; }
      else { stable = 0; last = cand; }
      if (Date.now() > deadline) return { settled: false, text: last };
    }
    return { settled: true, text: last };
  }

  const tools = [
    {
      name: 'vgpu_chat_open',
      description: '[agent overlay — read-only] Open vgpu.sh\'s Ask AI panel if closed. No-op when already visible. Use before send when no chat input is visible.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (textarea()) return J({ visible: true, already: true });
        const btn = byText(/ask ai/i);
        if (!btn) throw new Error('no Ask AI trigger found');
        btn.click();
        for (let i = 0; i < 20; i++) { await sleep(250); if (textarea()) return J({ visible: true, already: false }); }
        throw new Error('panel did not open');
      },
    },
    {
      name: 'vgpu_chat_close',
      description: '[agent overlay — read-only] Close the Ask AI panel. Conversation state may persist (see vgpu_chat_clear for a true reset).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const btn = byText(/close chat/i);
        if (!btn) return J({ visible: !!textarea(), closed: false, note: 'no close control; panel already minimal' });
        btn.click();
        await sleep(500);
        return J({ visible: !!textarea(), closed: !textarea() });
      },
    },
    {
      name: 'vgpu_chat_send',
      description: '[agent overlay] Submit one message to vgpu.sh\'s docs agent. Returns immediately with accepted/ streaming — the return is NOT the answer; read it with vgpu_chat_read. One message per call.',
      inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'The message text, one question per call' } }, required: ['message'] },
      execute: async ({ message }) => J(await send(message)),
    },
    {
      name: 'vgpu_chat_read',
      description: '[agent overlay — read-only] Read the Ask AI transcript now: current text, whether it is still streaming, and cited source count if shown. The verification read — ground truth over any earlier return.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const ta = textarea();
        if (!ta) throw new Error('chat input not visible');
        return J(readScope(ta));
      },
    },
    {
      name: 'vgpu_chat_stop',
      description: '[agent overlay] Halt a still-streaming answer. No-op when nothing is streaming. Use to bound a mistaken or runaway send.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const ta = textarea();
        if (!ta) throw new Error('chat input not visible');
        const btn = submitBtn(ta);
        if (!isStreaming(btn)) return J({ stopped: false, reason: 'not streaming' });
        btn.click();
        await sleep(500);
        return J({ stopped: !isStreaming(submitBtn(ta)) });
      },
    },
    {
      name: 'vgpu_chat_clear',
      description: '[agent overlay] Start a fresh conversation (Clear chat). Call at task start so no prior history contaminates this task; panel open-state persists in the browser, only the transcript resets.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const btn = byText(/clear chat/i);
        if (!btn) throw new Error('no Clear chat control — history may persist across tasks');
        btn.click();
        await sleep(750);
        return J({ cleared: true });
      },
    },
    {
      name: 'ask_vgpu_docs',
      description: '[agent overlay — read-only] Ask vgpu.sh\'s docs agent one question and wait for the settled answer with sources. Convenience over vgpu_chat_send + vgpu_chat_read. Does not clear history — call vgpu_chat_clear first for a fresh task.',
      inputSchema: { type: 'object', properties: { question: { type: 'string' }, timeoutMs: { type: 'number', description: 'Max wait (default 90000)' } }, required: ['question'] },
      execute: async ({ question, timeoutMs }) => {
        await send(question);
        const ta = textarea();
        const res = await waitSettled(ta, timeoutMs);
        const read = readScope(ta);
        // Harden: scope chrome (panel title, echoed question, source-count
        // header) varies by render — strip it defensively, keep the answer.
        let ans = res.text || '';
        const qi = ans.lastIndexOf(question);
        if (qi >= 0) ans = ans.slice(qi + question.length);
        ans = ans.replace(/^\s*Chat\s*/, '').replace(/^\s*Used \d+ sources?\s*/, '').trim();
        return J({ question, answer: ans || res.text, settled: res.settled, streaming: read.streaming, sourcesUsed: read.sourcesUsed });
      },
    },
  ];

  for (const t of tools) {
    try {
      await mc.registerTool(t);
      out.push('ok:' + t.name);
    } catch (e) {
      out.push('fail:' + t.name + ':' + ((e && e.message) || e));
    }
  }
  return out.join('\n');
})()
