// agent-webmcp overlay: perplexity.ai thread agent.
//
// perplexity.ai exposes no WebMCP tools. The page IS the agent: homepage
// composer (Lexical contenteditable, Search button) -> /search/<id> thread.
// This pack drives the composer and reads streamed answers.
//
// GATE: mounted-stop (observed 2026-09-12, verified live): while streaming,
//   button[aria-label^="Stop"] (32x32, "Stop response (Esc)") is mounted and
//   visible; on done it is REMOVED from the DOM. Submit stays "Search"
//   throughout (type=button, no aria flip). Done = Stop absent AND text
//   stable across two polls. Never use the submit label as the signal.
//
// Lexical notes: set text via focus + selectAll + execCommand(insertText),
//   wait for the echo (model applies async, ~1-3s), then submit with an
//   Enter keydown on the editor. A raw button click with a stale model
//   no-ops. Follow-up turns stay on the same /search/<id> URL (only the
//   first ask navigates: / -> /search/new/<id> -> /search/<id>).
//
// Install: agent-webmcp tools add packs/perplexity-ai.js --for perplexity.ai
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function visibleComposer() {
    const all = [...document.querySelectorAll('[contenteditable="true"]')];
    return all.find((e) => e.offsetParent !== null) || null;
  }
  function stopBtn() {
    const b = document.querySelector('button[aria-label^="Stop"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? b : null;
  }
  function searchBtn() {
    const eds = visibleComposer();
    const scope = eds ? eds.closest('div') : document;
    const inScope = [...scope.querySelectorAll('button')]
      .find((b) => (b.innerText || '').trim() === 'Search');
    if (inScope) return inScope;
    return [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').trim() === 'Search'
        || b.getAttribute('aria-label') === 'Submit') || null;
  }
  function homeBtn() {
    return [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').trim() === 'Back home'
        || b.getAttribute('aria-label') === 'Back home') || null;
  }
  function lastProse() {
    const ps = [...document.querySelectorAll('div.prose')];
    return ps.length ? ps[ps.length - 1] : null;
  }
  function readState() {
    const ed = visibleComposer();
    const s = searchBtn();
    const stop = stopBtn();
    const prose = lastProse();
    return {
      composerFound: !!ed,
      submitText: s ? (s.innerText || '').trim().slice(0, 20) : null,
      submitAria: s ? s.getAttribute('aria-label') : null,
      submitDisabled: s ? !!s.disabled : null,
      stopVisible: !!stop,
      streaming: !!stop,
      bodyChars: (document.body.innerText || '').length,
      nAnswers: document.querySelectorAll('div.prose').length,
      lastAnswerChars: (prose?.innerText || '').length,
      url: location.href,
      thread: location.href.includes('/search/'),
    };
  }
  function extract(question) {
    const prose = lastProse();
    if (prose?.innerText?.trim()) return prose.innerText.trim();
    const body = document.body.innerText || '';
    const qi = question ? body.lastIndexOf(question.slice(0, 30)) : -1;
    return (qi >= 0 ? body.slice(qi) : body)
      .replace(/Ask a follow-up.*$/s, '').trim();
  }
  async function waitDone(question, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 90000);
    let last = '', stable = 0;
    for (;;) {
      await sleep(1000);
      const streaming = !!stopBtn();
      const cand = extract(question);
      if (!cand || streaming) { stable = 0; if (cand) last = cand; }
      else if (cand === last) { if (++stable >= 2) break; }
      else { stable = 0; last = cand; }
      if (Date.now() > deadline) return { answer: last, timedOut: true };
    }
    return { answer: last, timedOut: false };
  }
  async function ask(question, timeoutMs) {
    const ed = visibleComposer();
    if (!ed) throw new Error('composer not found (no visible contenteditable)');
    ed.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, question);
    const probe = question.slice(0, 20);
    let echoed = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if ((ed.innerText || '').includes(probe)) { echoed = true; break; }
    }
    if (!echoed) throw new Error('composer did not take the text (no echo)');
    ed.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true,
    }));
    let seen = false;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (stopBtn() || (document.body.innerText || '').includes(probe)) { seen = true; break; }
    }
    if (!seen) throw new Error('submit did not register (no stream start, no echo)');
    const { answer, timedOut } = await waitDone(question, timeoutMs);
    if (!answer) throw new Error('agent did not answer within timeout');
    return {
      question,
      answer: timedOut ? answer + ' [stream still open at timeout]' : answer,
      url: location.href,
    };
  }

  const TOOLS = [
    {
      name: 'px_open',
      description: '[agent overlay] Open perplexity.ai home (fresh thread) and focus the composer. Reversible.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        if (!location.href.match(/^https:\/\/www\.perplexity\.ai\/?$/)) {
          const home = homeBtn();
          if (home) home.click();
          else location.href = 'https://www.perplexity.ai/';
          await sleep(2000);
        }
        visibleComposer()?.focus();
        return J(readState());
      },
    },
    {
      name: 'px_ask',
      description: '[agent overlay — read-only] Ask perplexity.ai one question; returns the streamed answer text. Consumes anonymous inference, changes nothing except thread history.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'One specific question per call' },
          timeoutMs: { type: 'number', description: 'Max wait for the streamed answer (default 90000)' },
        },
        required: ['question'],
      },
      execute: async ({ question, timeoutMs }) => J(await ask(question, timeoutMs)),
    },
    {
      name: 'px_state',
      description: '[agent overlay — read-only] Composer/thread state: streaming flag (Stop mounted), submit label, answer sizes, URL.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J(readState()),
    },
    {
      name: 'px_stop',
      description: '[agent overlay] Stop the in-flight perplexity.ai response. Reversible (partial answer stays).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        for (let i = 0; i < 4; i++) {
          const b = stopBtn(); // fresh node each try (panel re-renders per token)
          if (!b) return J({ stopped: true, attempts: i, ...readState() });
          for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
            b.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
          }
          await sleep(1200);
        }
        return J({ stopped: !stopBtn(), attempts: 4, ...readState() });
      },
    },
    {
      name: 'px_clear',
      description: '[agent overlay] Leave the thread for a fresh homepage composer. Prior anonymous thread stays in sidebar history.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const home = homeBtn();
        if (!home) throw new Error('home control not found');
        home.click();
        await sleep(2000);
        return J(readState());
      },
    },
  ];

  for (const t of TOOLS) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})();
