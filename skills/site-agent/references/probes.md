# site-agent-probes — eval snippets for mapping a site agent

Run through `agent-webmcp eval --session <name>`. Keep each call under ~10s; loop short evals from the shell for polling. All snippets are reads except where marked (actuation belongs to the pack, not the probes).

## 1. Panel skeleton (one eval)

```js
(() => {
  const ta = document.querySelector('textarea[placeholder], textarea[name=message]');
  if (!ta) return JSON.stringify({ chat: false });
  const form = ta.closest('form');
  const btn = form ? form.querySelector('button[type=submit]') : null;
  const panel = ta.closest('aside, [role=dialog], div[class*=chat]');
  return JSON.stringify({
    chat: true,
    textarea: { placeholder: ta.getAttribute('placeholder'), name: ta.name, maxlength: ta.maxLength },
    submit: btn ? { aria: btn.getAttribute('aria-label'), disabled: btn.disabled, text: (btn.innerText || '').slice(0, 40) } : null,
    panel: panel ? panel.tagName + '.' + (panel.className || '').split(' ').slice(0, 4).join('.') : null,
  });
})()
```

Done when `chat: true` with all four selectors held.

## 2. Controls (one eval)

```js
(() => {
  const labels = ['Copy chat', 'Expand chat', 'Collapse chat', 'Clear chat', 'Close chat'];
  const found = {};
  for (const l of labels) found[l] = !!document.querySelector(`button[aria-label="${l}"]`);
  const triggers = [...document.querySelectorAll('button')].filter(b => /ask ai/i.test(b.innerText || '')).length;
  const wrapper = document.querySelector('textarea[name=message], textarea[placeholder]')?.closest('aside')?.parentElement;
  return JSON.stringify({ found, askAiTriggers: triggers,
    wrapperState: wrapper?.getAttribute('data-state') ?? null });
})()
```

Done when open (Ask-AI trigger or hotkey), fullscreen (Expand/Collapse), clear, and close controls are each identified or marked absent.

## 3. Gate determination (shell-side loop, one live ask)

Ask one short question through the pack (or once by hand via the panel), then poll this every ~500ms from the shell until done or 90s:

```js
(() => {
  const ta = document.querySelector('textarea[name=message], textarea[placeholder]');
  const btn = ta?.closest('form')?.querySelector('button[type=submit]');
  const aside = ta?.closest('aside, [role=dialog]') || document.body;
  const text = aside.innerText || '';
  return JSON.stringify({
    aria: btn?.getAttribute('aria-label'),
    hasUserTurn: /is-user/.test(aside.innerHTML),
    shimmer: /Thinking|Searching|Running|Working|Reading/.exec(text)?.[0] ?? null,
    hasProse: aside.querySelector('div.is-assistant div.space-y-4, div.is-assistant [class*=prose]') ? true : false,
    len: text.length,
  });
})()
```

Decide on the log, not on one sample:

- **aria gate**: `aria` flips idle → streaming value → idle, aligned with answer growth.
- **DOM gate**: `aria` constant; `shimmer` present then absent; `hasProse` flips false → true with `len` stable across two polls.

Done when the gate is named in your notes with the observed values quoted.

## 4. Answer-scope check (one eval, after done)

```js
(() => {
  const turns = [...document.querySelectorAll('div.is-assistant')];
  const last = turns[turns.length - 1];
  const prose = last?.querySelector('div.space-y-4, [class*=prose]');
  return JSON.stringify({ nAssistant: turns.length,
    scopedChars: (prose?.innerText || '').length });
})()
```

Prefer the scoped prose node for extraction when `scopedChars > 0`; fall back to whole-panel `innerText` with chrome stripped (`Chat`, `Tip:…`, `N / 1000`, `Powered by`, transient lines, `Used N sources` toggle).
