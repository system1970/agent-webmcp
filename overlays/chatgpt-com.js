// agent-webmcp overlay: conversational chat tools for chatgpt.com.
//
// chatgpt.com ships 5 native tools (submit_conversation_message, submitQuery,
// open_conversation, scroll_to_conversation_message, open_chat_sidebar) but
// they return once submission STARTS — no tool waits for and returns the
// assistant's answer text. This pack adds ask_chatgpt (submit + stream-settle
// + answer), read_chatgpt_answer (settle + answer only, for reads after the
// first-message navigation unregisters page tools), and new_chatgpt_chat
// (fresh conversation), mirroring overlays/eve-dev.js.
//
// Install: agent-webmcp tools add overlays/chatgpt-com.js --for chatgpt.com
// (run while a chatgpt.com tab is active; registrations live until navigation.)
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });

  function nodes() {
    const ta = document.querySelector('textarea#mobile-composer-prompt, textarea[placeholder="Ask ChatGPT"]');
    if (!ta) return null;
    const form = ta.closest('form') || document.body;
    const send = form.querySelector('button[aria-label="Send message"]');
    if (!send) return null;
    return { ta, form, send };
  }

  function stopBtn() { return document.querySelector('[data-testid="stop-button"]'); }

  // Logged-out/mobile shell markup: DIV.wm-app-threadContent > OL > LI(messageTurn)
  // with H4 "ChatGPT said:" / "You said:" headers — no data-message-author-role attrs.
  function turns(said) {
    return [...document.querySelectorAll('li')].filter((li) => {
      const h = li.querySelector('h1,h2,h3,h4,h5');
      return h && (h.innerText || '').trim() === said;
    });
  }
  function stripTurn(li, header) {
    let t = (li.innerText || '').trim();
    t = t.replace(header, '').trim();
    t = t.replace(/ChatGPT is AI and can make mistakes\.?[\s\S]*$/, '').trim();
    return t;
  }
  function lastAssistant() {
    const list = turns('ChatGPT said:');
    if (list.length === 0) return '';
    return stripTurn(list[list.length - 1], 'ChatGPT said:');
  }
  function userEcho(message) {
    const needle = message.slice(0, 40);
    return turns('You said:').some((li) => (li.innerText || '').includes(needle));
  }

  function setText(ta, text) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function settle(timeoutMs) {
    // done = stop button gone AND last assistant text identical twice (500ms cadence)
    const deadline = Date.now() + (timeoutMs || 120000);
    let last = '', stable = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const cand = lastAssistant();
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
    if (!last) throw new Error('assistant did not answer within timeout');
    const done = Date.now() > deadline;
    return done ? last + ' [stream still open at timeout]' : last;
  }

  async function ask(message, timeoutMs) {
    const n = nodes();
    if (!n) throw new Error('chat composer not found — a login wall is likely up (log in once in this window, then retry)');
    // Follow-up inside a conversation: no navigation risk, settle fully here.
    if (location.pathname.length > 1) {
      setText(n.ta, message);
      n.send.click();
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        if (stopBtn() || userEcho(message)) break;
      }
      if (!stopBtn() && !userEcho(message)) {
        throw new Error('chat submit did not register (no stream start; login may be required)');
      }
      return { message, submitted: true, answer: await settle(timeoutMs) };
    }
    // First message from home: the submit navigates home→convo and the
    // execution context may die with the transition. Set, click, and return
    // synchronously (zero awaits after click) so the reply beats the unload.
    // Caller verifies with a fresh read, then reads the answer.
    setText(n.ta, message);
    n.send.click();
    return { message, submitted: true, answer: null, note: 'first message: verify submit landed, run read_chatgpt_answer for the answer' };
  }

  async function fresh() {
    const btn = [...document.querySelectorAll('button, a')].find((b) => /^\s*new chat\s*$/i.test(b.innerText || ''));
    if (!btn) throw new Error('New chat control not found');
    // Clicking navigates, which may kill a waiting execute — return synchronously.
    btn.click();
    return { cleared: true };
  }

  try {
    await mc.registerTool({
      name: 'ask_chatgpt',
      description: '[agent overlay] Ask ChatGPT a question. Inside a conversation it submits, waits for the streamed answer, and returns {message, submitted:true, answer}. The FIRST message navigates home→convo, so it submits and returns {message, submitted:true, answer:null} immediately — verify, then call read_chatgpt_answer. Drives the visible composer; creates/extends a conversation (consumes inference, not read-only).',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The message to send, one specific question per call' },
          timeoutMs: { type: 'number', description: 'Max wait for the streamed answer (default 120000)' },
        },
        required: ['message'],
      },
      execute: async ({ message, timeoutMs }) => J(await ask(message, timeoutMs)),
    });
    out.push('ok:ask_chatgpt');
  } catch (e) {
    out.push('fail:ask_chatgpt:' + ((e && e.message) || e));
  }

  try {
    await mc.registerTool({
      name: 'read_chatgpt_answer',
      description: '[agent overlay — read-only] Wait for the current ChatGPT answer to finish streaming and return its text. Use after a submit whose ask_chatgpt call returned empty (first-message navigation unregisters page tools: run tools load, then call this). Never submits anything.',
      inputSchema: {
        type: 'object',
        properties: {
          timeoutMs: { type: 'number', description: 'Max wait for the streamed answer (default 120000)' },
        },
      },
      execute: async ({ timeoutMs }) => J({ answer: await settle(timeoutMs) }),
    });
    out.push('ok:read_chatgpt_answer');
  } catch (e) {
    out.push('fail:read_chatgpt_answer:' + ((e && e.message) || e));
  }

  try {
    await mc.registerTool({
      name: 'new_chatgpt_chat',
      description: '[agent overlay] Start a fresh ChatGPT conversation. Navigation unregisters page tools, so run tools load before the next invoke.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J(await fresh()),
    });
    out.push('ok:new_chatgpt_chat');
  } catch (e) {
    out.push('fail:new_chatgpt_chat:' + ((e && e.message) || e));
  }

  return out.join('\n');
})()
