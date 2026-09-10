// agent-webmcp overlay: docs-agent chat for eve.dev.
//
// eve.dev ships 2 native tools (search_docs, read_current_page) but no tool
// for its Ask AI docs agent. This pack adds ask_eve_docs, which drives the
// site's own chat panel (textarea + submit in the fixed right aside) and
// returns the agent's answer text.
//
// Install: agent-webmcp tools add overlays/eve-dev.js --for eve.dev
// (run while an eve.dev docs tab is active; registrations live until navigation.)
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

  function chatNodes() {
    const ta = document.querySelector('textarea[placeholder]');
    if (!ta || !ta.form) return null;
    const btn = ta.form.querySelector('button[type="submit"]');
    const aside = ta.closest('aside') || document.body;
    if (!btn) return null;
    return { ta, btn, aside };
  }

  function cleanPanel(text, question) {
    return text
      .replace(/^Chat\s*/, '')
      .replace(/\d+\s*\/\s*1000\s*$/, '')
      .replace(/Powered by.*$/, '')
      .split(question)[0]
      .trim();
  }

  async function ask(question, timeoutMs) {
    const n = chatNodes();
    if (!n) throw new Error('docs-agent chat panel not found on this page');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(n.ta, '');
    n.ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(n.ta, question);
    n.ta.dispatchEvent(new Event('input', { bubbles: true }));
    n.btn.click();
    // Observed exacts (recorded live): click -> aria Submit->Stop ~0.3s,
    // first tokens ~2s, Stop->Submit flip coincides with final text.
    // Panel len jumps around mid-stream (re-renders), so text-stability
    // alone is unreliable: the aria gate is the completion signal.
    const isStreaming = () => /stop/i.test(n.btn.getAttribute('aria-label') || '');
    // 1. confirm the submit landed (aria flips or question echoes, 10s budget)
    let seen = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const text = n.aside.innerText || '';
      if (isStreaming() || text.includes(question)) { seen = true; break; }
    }
    if (!seen) throw new Error('chat submit did not register (no stream start)');
    // 2. done = aria back to Submit AND text identical twice (250ms cadence:
    // ~0.5s detection lag; never settle while streaming).
    const deadline = Date.now() + (timeoutMs || 90000);
    const TRANSIENT = /^(Running|Thinking|Working|Searching|Reading)\b/i;
    let last = '', stable = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 250));
      const text = n.aside.innerText || '';
      const qi = text.lastIndexOf(question);
      let cand = (qi >= 0 ? text.slice(qi + question.length) : '').replace(/^\s+/, '');
      cand = cand.split(question)[0].replace(/Powered by.*$/s, '').replace(/\d+\s*\/\s*1000\s*$/, '').trim();
      cand = cand.split('\n').filter((l) => !TRANSIENT.test(l.trim())).join('\n').trim();
      if (!cand || isStreaming()) { stable = 0; if (cand) last = cand; }
      else if (cand === last) {
        stable++;
        if (stable >= 2) break;
      } else {
        stable = 0;
        last = cand;
      }
      if (Date.now() > deadline) break;
    }
    if (!last) throw new Error('docs agent did not answer within timeout');
    const done = Date.now() > deadline;
    const sources = /Used (\d+) sources?/.exec(last);
    return { question, answer: done ? last + ' [stream still open at timeout]' : last, sourcesUsed: sources ? Number(sources[1]) : null };
  }

  try {
    await mc.registerTool({
      name: 'ask_eve_docs',
      description: '[agent overlay — read-only] Ask eve.dev\'s own docs agent a question and get its answer text. Use this for how/why/explain questions the search_docs + read_current_page tools cannot answer directly. Drives the site\'s Ask AI panel; read-only (consumes the site\'s demo inference, changes nothing).',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The docs question, one specific question per call' },
          timeoutMs: { type: 'number', description: 'Max wait for the streamed answer (default 90000)' },
        },
        required: ['question'],
      },
      execute: async ({ question, timeoutMs }) => J(await ask(question, timeoutMs)),
    });
    out.push('ok:ask_eve_docs');
  } catch (e) {
    out.push('fail:ask_eve_docs:' + ((e && e.message) || e));
  }
  return out.join('\n');
})()
