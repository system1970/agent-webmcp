---
skill: prism
title: Prism
kind: site-agent
description: Work Prism (prism.openai.com) — list projects, read files and outline, list and read chat threads, search, export PDF. Use when the task needs the user's Prism workspace, LaTeX documents, or research threads. Login required (user-owned session); read verbs freely, chat sends and edits only on explicit per-task approval.
site: [prism.openai.com]
tags: [docs, latex, research, chat, openai]
tier: official
category: docs
verified: 2026-09-17
updated: 2026-09-17
access: login
verbs: [prism_list_projects, prism_open_project, prism_list_files, prism_read_file, prism_read_outline, prism_list_chats, prism_open_chat, prism_read_thread, prism_list_tabs, prism_search_project, prism_export_pdf, prism_read_settings]
readonly: [prism_list_projects, prism_open_project, prism_list_files, prism_read_file, prism_read_outline, prism_list_chats, prism_open_chat, prism_read_thread, prism_list_tabs, prism_search_project, prism_export_pdf, prism_read_settings]
---

# Prism

Work the Prism LaTeX workspace on `prism.openai.com` (login required —
the session carries the user's own ChatGPT auth; never drive another
account). Prism has no API, no MCP, no CLI — these verbs are the plug.
Read grade is green; act grade (ask/edit/compile/create) ships only
after live proof, one verb at a time, with per-task approval.

## Open, read, verify

1. `prism_list_projects` — workspace home (`?pg=0`): All / Yours /
   Shared tabs. Done when you hold `{id, title, age}` rows.
2. `prism_open_project {project_id}` — navigates to `?u=<id>&pg=1`.
   Done when Files tree + outline render.
3. `prism_list_files` — expands folders, returns the tree. Done when
   every visible file/folder is captured (Orkestrate/ holds A2A.tex,
   AGENTS.draft.md, inference-system-spec.tex — expand, never assume).
4. `prism_read_file {path}` — opens `?m=<path>`, returns editor text.
   Done when content length is stable across two reads.
5. `prism_list_chats` — Chats tab → thread titles + ages. Done when
   the list is captured (rows are DIV[role=button], not buttons).
6. `prism_open_chat {chat}` + `prism_read_thread` — pointer-sequence
   click on the thread row (bare el.click() is ignored — Radix needs
   focus + pointerdown/pointerup/click), then read the composer-
   ancestor scope. Done when messages render with roles.
7. `prism_search_project {query}` — project search box + scope
   filters. Submit path unmapped — do not ship until grounded.
8. `prism_export_pdf` — Download PDF control. Done when the file
   lands on disk with size > 0.
9. `prism_read_settings` — six sections (Editor, PDF Viewer, File
   Management, Data Controls, Beta features, Integrations). Read
   only — never toggle, never save.

## Act grade (unproven — needs live proof + approval)

- `prism_chat_ask` — composer ("Ask anything") + model picker
  (6 Astra / 5.6 Sol / 5.6 Terra; effort Low–XHigh — read, never
  change the user's selection) + submit. Appends to the user's
  history: explicit per-task approval, fresh tab preferred.
- `prism_create_chat`, `prism_create_file`, `prism_edit_file`
  (old-block match required), `prism_compile` (errors verbatim),
  `prism_upload_file`, `prism_create_project`, `prism_import_project`.
- Transact (explicit approval, never implied): `prism_invite_member`,
  `prism_zotero_connect` (external OAuth), `prism_export_all_zip`
  is Answer-grade (own data out).

## Tool reference

Read verbs report their completion inline (counts, chars, stable
twice). History and files are the user's own work — route every
output to reasoning; never exfiltrate, never alter without approval.

## Coverage

- Supported: projects/files/outline/chats-list/thread-open/thread-
  read/search-panel/model-options/settings (all six sections).
  Grounded 2026-09-17, headful, read-only.
- Known, not covered: search submit (typed, no results rendered);
  Tools tab contents (tab found, panel unmapped); More-options menu;
  thread message bodies beyond the selected thread; New-chat-tab
  behavior; Invite dialog; Import flow.
- Unknown: mobile layout, shared-workspace (non-owner) behavior,
  headless viability (assume stalls until proven).

## Troubleshooting

- Thread rows ignore bare clicks → focus + pointerdown/pointerup/
  click sequence (site-forge: Radix rule).
- Avatar/user menus ignore bare clicks → same sequence.
- `el.click()` on Radix triggers silently no-ops (aria-expanded
  stays false) — always verify state after, never assume.
- Thread list renders rows as DIV[role=button] — scope queries to
  role, not tag.
- No `/settings` route (404) — settings is a view behind the avatar
  menu, not a URL.

## Examples

- Live 2026-09-17 (headful, read-only): home → project (u=2e379fdc)
  → Chats → "Who: Orkestrate — early" → 19k-char transcript read
  (user brief + assistant answer, roles intact).
- Live 2026-09-17: avatar menu → Settings → all six sections read
  (Editor defaults, PDF Dark Mode + Zoom Shortcuts, hidden-file
  patterns, Export-all-zip, beta opt-in, Zotero Connect).
