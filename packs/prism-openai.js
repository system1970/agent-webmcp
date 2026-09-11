// agent-webmcp custom tools: conversational chat for prism.openai.com.
//
// Prism (OpenAI's AI LaTeX editor) ships no native WebMCP tools. This pack adds
// ask_prism (submit + stream-settle + answer) and new_prism_chat, following
// overlays/chatgpt-com.js. Verified live: composer is
// textarea[placeholder="Ask anything"], send is the last unlabeled button
// (up-arrow) in its wrapper, answers render as div.markdown-block (user
// messages do not), no first-message navigation (chat stays inline, same URL).
//
// Install: agent-webmcp tools add overlays/prism-openai.js --for prism.openai.com
// (run while a prism.openai.com tab is active; registrations live until navigation.)
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  let marked = false;

  function vis(e) { return !!(e && e.getClientRects && e.getClientRects().length > 0); }

  function nodes() {
    const tas = [...document.querySelectorAll('textarea[placeholder="Ask anything"]')].filter(vis);
    if (tas.length === 0) return null;
    const ta = tas[0];
    let up = ta.parentElement;
    for (let i = 0; i < 6 && up; i++) {
      if (up.querySelectorAll('button').length > 0) break;
      up = up.parentElement;
    }
    if (!up) return null;
    const un = [...up.querySelectorAll('button')].filter((b) => vis(b) && !(b.getAttribute('aria-label') || ''));
    if (un.length === 0) return null;
    return { ta, send: un[un.length - 1] };
  }

  // Completion signal (verified live): while the agent thinks or streams, the
  // composer send button is replaced by <button data-testid="ai-stop-button">.
  // Done = stop button gone AND the answer run stable twice.
  function stopBtn() { return document.querySelector('[data-testid="ai-stop-button"]'); }

  function blockEls() { return [...document.querySelectorAll('div.markdown-block')]; }

  function blockText(b) { return ((b.innerText || '').trim()); }

  // Marker-based run: the chat list is virtualized (block COUNT varies with
  // scroll), so index slices lie. Tag the last block element; the answer is
  // every non-empty block after the marker in document order.
  function markRun() {
    document.querySelectorAll('[data-ask-base]').forEach((e) => e.removeAttribute('data-ask-base'));
    marked = false;
    const els = blockEls();
    const base = els.length > 0 ? els[els.length - 1] : null;
    if (base) { base.setAttribute('data-ask-base', '1'); marked = true; }
    return marked;
  }

  function runText() {
    const els = blockEls();
    const anchor = document.querySelector('[data-ask-base]');
    if (marked && !anchor) return ''; // marker virtualized away: wait, never return stale
    if (!anchor) {
      return els.map(blockText).filter((t) => t.length > 0).join('\n\n');
    }
    let past = false;
    const ans = [];
    for (const b of els) {
      if (!past) {
        if (b.hasAttribute && b.hasAttribute('data-ask-base')) past = true;
        continue;
      }
      const t = blockText(b);
      if (t.length > 0) ans.push(t);
    }
    return ans.join('\n\n');
  }

  function setText(ta, text) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return (ta.value || '') === text;
  }

  async function settle(timeoutMs) {
    // done = stop button gone AND answer run identical twice (500ms cadence)
    const deadline = Date.now() + (timeoutMs || 180000);
    let last = '', stable = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const cand = runText();
      if (!cand || stopBtn()) { stable = 0; if (cand) last = cand; }
      else if (cand === last) {
        stable++;
        if (stable >= 2) break;
      } else {
        stable = 0;
        last = cand;
      }
      if (Date.now() > deadline) break;
    }
    if (!last) throw new Error('prism assistant did not answer within timeout');
    const done = Date.now() > deadline;
    return done ? last + '\n\n[stream still open at timeout]' : last;
  }

  function liveComposer() {
    const ta = [...document.querySelectorAll('textarea[placeholder="Ask anything"]')].find(vis) || null;
    return ta;
  }

  async function ask(message, timeoutMs) {
    const n = nodes();
    if (!n) throw new Error('prism composer not found (login wall? log in once in this window, then retry)');
    if (!setText(n.ta, message)) throw new Error('prism composer rejected the text (value did not stick)');
    markRun();
    // Wait for an enabled send (it disables during loads), then click.
    let send = null;
    const deadline0 = Date.now() + 15000;
    while (Date.now() < deadline0) {
      const cur = nodes();
      if (cur && !cur.send.disabled) { send = cur.send; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!send) throw new Error('prism send button never enabled within 15s');
    send.click();
    // Confirm the turn opened: the composer must CLEAR (a retained value would
    // fake echo checks) plus the stop button, a post-marker block, or genuine
    // chat echo. Generous budget: extra-high thinks for minutes first.
    const need = message.slice(0, 40);
    let seen = false, diag = '';
    const deadline1 = Date.now() + 120000;
    while (Date.now() < deadline1) {
      await new Promise((r) => setTimeout(r, 1000));
      const ta = liveComposer();
      const val = ta ? (ta.value || '') : '<gone>';
      if (val !== '') { diag = 'composer still holds ' + val.length + ' chars'; continue; }
      if (stopBtn()) { seen = true; break; }
      if (runText() !== '') { seen = true; break; }
      const chatEcho = blockEls().some((b) => blockText(b).includes(need));
      if (chatEcho) { seen = true; break; }
      diag = 'composer cleared, no turn signal yet';
    }
    if (!seen) throw new Error('prism submit did not register within 120s (' + diag + ')');
    return { message, answer: await settle(timeoutMs) };
  }

  async function fresh() {
    const btn = [...document.querySelectorAll('button')].find((b) => /new chat tab/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) throw new Error('New chat control not found');
    btn.click();
    return { cleared: true };
  }

  try {
    await mc.registerTool({
      name: 'ask_prism',
      description: '[agent custom — read/write] Ask the Prism assistant a question and get its answer text. Drives the Ask-anything composer; consumes inference and extends the chat (not read-only). Model/effort follow the page picker (e.g. 6 Astra Extra high).',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send, one specific question per call' },
          timeoutMs: { type: 'number', description: 'Max wait for the streamed answer (default 180000)' },
        },
        required: ['message'],
      },
      execute: async ({ message, timeoutMs }) => J(await ask(message, timeoutMs)),
    });
    out.push('ok:ask_prism');
  } catch (e) {
    out.push('fail:ask_prism:' + ((e && e.message) || e));
  }

  try {
    await mc.registerTool({
      name: 'read_prism_answer',
      description: '[agent custom — read-only] Wait for the current Prism answer to finish streaming and return its FULL text (all paragraphs). Use after a submit whose ask_prism call failed but the turn opened anyway, or to re-read the latest answer. Never submits anything.',
      inputSchema: {
        type: 'object',
        properties: {
          timeoutMs: { type: 'number', description: 'Max wait for the streamed answer (default 180000)' },
        },
      },
      execute: async ({ timeoutMs }) => J({ answer: await settle(timeoutMs) }),
    });
    out.push('ok:read_prism_answer');
  } catch (e) {
    out.push('fail:read_prism_answer:' + ((e && e.message) || e));
  }

  try {
    await mc.registerTool({
      name: 'new_prism_chat',
      description: '[agent custom] Start a fresh Prism chat tab so answers do not inherit prior context.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J(await fresh()),
    });
    out.push('ok:new_prism_chat');
  } catch (e) {
    out.push('fail:new_prism_chat:' + ((e && e.message) || e));
  }

  return out.join('\n');
})()
