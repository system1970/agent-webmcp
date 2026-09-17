// agent-webmcp overlay for prism.openai.com: workspace read verbs.
// Built 2026-09-17 from raw scan/act turns (headful, read-only).
// READ GRADE ONLY — act-grade verbs (ask/edit/compile/create) land
// after live proof, one at a time.
//
// Grounded surface facts (prism.openai.com, headful, user-owned login):
// - Home ?pg=0: project rows link to ?u=<uuid>&pg=1. Files view adds
//   &m=<path>. No /settings route (404) — settings is a view behind
//   the avatar menu.
// - Thread rows are DIV[role=button], NOT <button> — scope all row
//   queries to role. They ignore bare el.click(): Radix needs focus +
//   pointerdown/pointerup/click. Same for avatar/user menus.
// - Open thread => chat panel appears; transcript scopes to the
//   composer ("Ask anything") ancestor with length > 300.
// - Chats list shows titles + ages; Files tree needs folder expand
//   (Orkestrate/ holds A2A.tex, AGENTS.draft.md,
//   inference-system-spec.tex — expand, never assume).
// - Model picker: 6 Astra / 5.6 Sol / 5.6 Terra; effort Low / Medium /
//   High / Extra high. READ ONLY — never change the user's selection.
// - Settings sections: Editor, PDF Viewer, File Management, Data
//   Controls (Export all zip), Beta features, Integrations (Zotero).
// - Trace leads (passive, unproven): GET /api/project-access,
//   GET /api/maintenance, GET /auth/entitlements,
//   POST /api/codex/conversation-history,
//   GET /api/codex/runtime/debug?conversation_id=...
// Install: agent-webmcp tools add overlay.js --for prism.openai.com
(async () => {
  const mc = document.modelContext || navigator.modelContext;
  if (!mc || !mc.registerTool) return 'NO WEBMCP API';
  const out = [];
  const J = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Radix-grade click: bare el.click() silently no-ops on Radix
  // triggers (aria-expanded stays false). Focus + pointer sequence.
  function rclick(el) {
    try { el.focus(); } catch (e) {}
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  function tabstrip() {
    // Tab strip items (file tabs, chat tabs, Tools) are role-less DIVs.
    return [...document.querySelectorAll('*')].filter((e) => e.children.length <= 1 &&
      /^(main\.tex|tools)$/i.test(((e.getAttribute && e.getAttribute('aria-label')) || e.innerText || '').trim()));
  }
  function threadRows() {
    return [...document.querySelectorAll('div[role=button]')].filter((e) =>
      /^\s*(who:|hey,|continuing|context:|paste this|i want you)/i.test((e.innerText || '').trim()));
  }
  function composer() {
    return [...document.querySelectorAll('textarea')].find((t) => /ask anything/i.test(t.placeholder || '')) || null;
  }
  function transcriptScope() {
    const c = composer();
    if (c) {
      let el = c, best = null;
      for (let i = 0; i < 10 && el && el !== document.body; i++) {
        el = el.parentElement;
        if (el && (el.innerText || '').length > 300) best = el;
      }
      if (best) return best;
    }
    return document.body;
  }
  function fileTree() {
    // Best-effort tree read: folder buttons + file buttons in Files view.
    const names = [...document.querySelectorAll('button')].map((b) => ((b.getAttribute('aria-label') || b.innerText) || '').trim().split('\n')[0])
      .filter((s) => s && !/^(files|chats|search|invite|new|add|expand|outline|compile|download|more|close|back)$/i.test(s));
    return [...new Set(names)].slice(0, 200);
  }

  const tools = [
    {
      name: 'prism_list_projects',
      description: '[agent overlay — read-only] List workspace projects from home (?pg=0): All/Yours/Shared rows with titles + ages. Returns [{title, age, url}]. Never creates anything.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const rows = [...document.querySelectorAll('a')].filter((a) => /\/\?u=[0-9a-f-]{8,}/.test(a.href || ''));
        const items = rows.map((a) => {
          const t = ((a.innerText || '').trim().split('\n'));
          return { title: t[0] || '', age: t[1] || '', url: a.href };
        }).filter((r) => r.title);
        return J({ projects: items });
      },
    },
    {
      name: 'prism_open_project',
      description: '[agent overlay — read-only] Open a project by id or title match (navigates to ?u=<id>&pg=1). No mutation — view only.',
      inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] },
      execute: async ({ project }) => {
        const rows = [...document.querySelectorAll('a')].filter((a) => /\/\?u=[0-9a-f-]{8,}/.test(a.href || ''));
        const hit = rows.find((a) => (a.href || '').includes(project)) ||
          rows.find((a) => ((a.innerText || '').toLowerCase().includes(String(project).toLowerCase())));
        if (!hit) return J({ opened: false, note: 'no project matches ' + project });
        location.href = hit.href;
        return J({ opened: true, url: hit.href });
      },
    },
    {
      name: 'prism_list_files',
      description: '[agent overlay — read-only] Read the Files tree (expand folders first via UI if needed). Returns visible file/folder names. Never creates or edits.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => J({ files: fileTree() }),
    },
    {
      name: 'prism_read_file',
      description: '[agent overlay — read-only] Read the open editor text (open the file first via its ?m= URL or the tree). Returns {chars, text}. Never types.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const scope = transcriptScope();
        const text = (scope.innerText || '').trim();
        return J({ chars: text.length, text: text.slice(0, 20000) });
      },
    },
    {
      name: 'prism_read_outline',
      description: '[agent overlay — read-only] Read the document outline sections. Never mutates.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const t = document.body.innerText || '';
        const i = t.indexOf('Outline');
        if (i < 0) return J({ outline: [] });
        const seg = t.slice(i, i + 3000).split('\n').map((s) => s.trim()).filter(Boolean).slice(1, 80);
        return J({ outline: seg });
      },
    },
    {
      name: 'prism_list_chats',
      description: '[agent overlay — read-only] List chat threads (titles + ages) from the Chats view. Thread rows are DIV[role=button]. Never sends.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const t = document.body.innerText || '';
        const lines = t.split('\n').map((s) => s.trim()).filter(Boolean);
        const chats = [];
        for (let i = 0; i < lines.length; i++) {
          if (/^(\d+[hdw]|new chat)$/i.test(lines[i]) && i > 0 && !/^(files|chats|outline)$/i.test(lines[i - 1])) {
            chats.push({ title: lines[i - 1], age: lines[i] });
          }
        }
        return J({ chats });
      },
    },
    {
      name: 'prism_open_chat',
      description: '[agent overlay — read-only] Select a chat thread by title match (Radix-grade click, view only — sends nothing). Returns whether the composer appeared.',
      inputSchema: { type: 'object', properties: { chat: { type: 'string' } }, required: ['chat'] },
      execute: async ({ chat }) => {
        const rows = [...document.querySelectorAll('div[role=button]')];
        const hit = rows.find((e) => ((e.innerText || '').toLowerCase().includes(String(chat).toLowerCase())));
        if (!hit) return J({ opened: false, note: 'no thread matches ' + chat });
        rclick(hit);
        for (let i = 0; i < 20; i++) {
          await sleep(250);
          if (composer() && composer().getBoundingClientRect().width > 50) return J({ opened: true, chat });
        }
        return J({ opened: false, note: 'thread clicked but chat panel did not appear' });
      },
    },
    {
      name: 'prism_read_thread',
      description: '[agent overlay — read-only] Read the open thread transcript (composer-ancestor scope). Never sends. Returns {chars, text}.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const scope = transcriptScope();
        const text = (scope.innerText || '').trim();
        return J({ chars: text.length, text: text.slice(0, 20000) });
      },
    },
    {
      name: 'prism_list_tabs',
      description: '[agent overlay — read-only] List the tab strip (file tabs, chat tabs, Tools). Tabs are role-less DIVs.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const items = tabstrip().map((e) => (e.innerText || '').trim()).filter(Boolean);
        return J({ tabs: [...new Set(items)] });
      },
    },
    {
      name: 'prism_read_settings',
      description: '[agent overlay — read-only] Read current settings view text (open Settings via the avatar menu first). NEVER toggles or saves — read only.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const t = document.body.innerText || '';
        return J({ chars: t.length, text: t.slice(0, 8000) });
      },
    },
  ];

  for (const t of tools) {
    try { await mc.registerTool(t); out.push('ok:' + t.name); }
    catch (e) { out.push('fail:' + t.name + ':' + ((e && e.message) || e)); }
  }
  return out.join('\n');
})()
