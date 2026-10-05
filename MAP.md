# MAP.md — agent-webmcp

Facts about this repo. Every fact names a file and a line.

This file is the map. The agent reads it at session start. The agent writes it
when the code moves. Only this region's agent writes this file.

## Rules for the map

1. Facts only. No guesses. If the code does not say it, the map does not say it.
2. Every fact ends with a source. `path:line`.
3. Every file described here has a hash. If the hash is not the hash of the
   file now, this map is old. Re-read the file. Write the map again.
4. Add to the map. Do not rewrite history. Delete a line only when the file it
   names is gone.
5. Use short sentences. One meaning per word. Say the thing straight.

## The map

### Shape of the repo

- One Go module, one main package. `cmd/agent-webmcp/*.go`, package main. go.mod:1
- Module path `github.com/system1970/agent-webmcp`, Go 1.25.0. go.mod:1, go.mod:3
- `github.com/coder/websocket` is the direct dependency. go.mod:5
- `github.com/dop251/goja` is imported directly by execmode.go but marked `// indirect` in go.mod. execmode.go:13, go.mod:9
- Second region in the repo: `website/`, a Next.js docs site. Its own guide is website/AGENTS.md:1
- Docs site stack: next 16.3.4, react 19.3.0, tailwind 4, typescript 7. website/package.json:9, website/package.json:11, website/package.json:13, website/package.json:15
- Docs pages live one per directory: website/app/docs/*/page.tsx (commands, codemode, custom-tools, installation, jev-loop, security, configuration, troubleshooting, quick-start, changelog).
- `.gitignore` excludes the built binary `/agent-webmcp`, all `*.log`, `.next/`, `node_modules/`. .gitignore:6, .gitignore:11, .gitignore:12, .gitignore:17

### The CLI surface

- `version` const is `0.4.0`. main.go:12
- Verb dispatch is one switch in `run()`. main.go:234
- Aliases: `navigate`/`goto` for open; `quit`/`exit` for close; `session` for sessions; `webmcp list` kept for agent-browser compat; `ls`/`rm` inside `tools`. main.go:241, main.go:276, main.go:299, main.go:372, customtools.go:527, customtools.go:628
- `usage()` prints to stderr; no args prints usage and exits 2. main.go:15, main.go:207
- usage() lists `auth <probe|handoff>` only; the vault verbs `save|login|list|show|delete` are real but absent from usage. main.go:32, auth.go:137, auth.go:151
- Global flags: `--session/-s`, `--profile`, `--json`, `--headed`, `--headless`, `--all`, `--params`, `--frame`, `--text`, `--chrome`, `--timeout-ms`, plus `--engine`, `--executable-path`, `--allowed-domains`. main.go:100, main.go:109, main.go:116, main.go:118, main.go:120, main.go:122, main.go:124, main.go:131, main.go:136, main.go:166, main.go:173, main.go:145, main.go:152, main.go:159
- Defaults: session `default`, timeout 30000ms, engine `chrome`, allowlist empty. main.go:89, engine.go:35, engine.go:101
- `AGENT_WEBMCP_SESSION` overrides the session name before flags are read. main.go:59
- `positionalURL` is the shared way a verb takes a page from a bare argument, so `run example.com` means what `open example.com` means. main.go:75
- Verb flags (`--goal`, `--for`, `--query`) are read separately by `verbFlag` from the leftover args. tools.go:46
- Exit contract: 0 success, 1 blocked/failed, 2 auth_required. run.go:103, auth.go:113
- Envelope: `{"ok":true,"data":...}` or `{"ok":false,"code":...,"error":...}`; failures return 1. output.go:15, output.go:20

### Engines

- `Engine` is a string type; Chrome and Lightpanda are the two values. engine.go:26, engine.go:29, engine.go:30
- `parseEngine` accepts `""`/`chrome`/`chromium` and `lightpanda`/`lp`; anything else is `bad_engine`. engine.go:33, engine.go:35, engine.go:37, main.go:213
- Chrome is the default engine. engine.go:35
- `Feature` is a capability only one engine has, with a refusal string per engine. engine.go:45, engine.go:60
- The LP refusal set: split verbs, WebMCP page tools, headed, profiles, layout, login flow. engine.go:52, engine.go:53, engine.go:54, engine.go:55, engine.go:56, engine.go:57
- `FeatureAct`, `FeatureGeometry` and `FeatureHitTest` were the earlier names; the refusal is now one fact about the connection. engine.go:48
- The split-verb refusal reason is stated in the error text: LP forgets every page when its CDP connection closes, so use `run`. engine.go:66
- LP has no layout, so `getBoundingClientRect` is approximate and `elementFromPoint` cannot be trusted — that rules out the Chrome hit-test, not the LP node path. engine.go:70, engine.go:16
- `requireChrome` refuses with the reason inline; refusal is the contract, never a silent degradation. engine.go:87, engine.go:76
- The gate is a switch on the verb, before the main dispatch. main.go:221, main.go:222
- Refused on Lightpanda: act/decide/tick (split verbs), invoke/execute/list/webmcp (WebMCP), auth (login flow), close (profiles). main.go:223, main.go:226, main.go:228, main.go:230
- `run` on Lightpanda opens and holds one connection for the whole loop. run.go:35, run.go:45
- The LP page comes from the positional URL, else from the session's last snapshot; there is no browser to ask. run.go:36, run.go:38, lploop.go:405

### Browser, profile, session

- Default profile name is `shared`; `--profile` or `AGENT_WEBMCP_PROFILE` isolates a browser. profile.go:26, profile.go:28
- One profile = one browser = one cookie jar, many tabs. profile.go:14
- Profile dir is `<home>/profiles/<name>` where home is the parent of the sessions root. profile.go:38
- Profile state files: `browser-port`, `browser.pid`, `headed`, Chrome profile dir `profile/`, plus `chrome.log`. profile.go:42, profile.go:43, profile.go:44, profile.go:45, profile.go:99
- Session root: `AGENT_WEBMCP_HOME/sessions`, else `~/.agent-webmcp/sessions`. session.go:13
- Session→tab binding is a file holding `profile\ntargetID`. profile.go:139, profile.go:147
- `sessionTarget` errors are remedies: `no_tab`, `no_browser`, `browser_dead`, `tab_gone`. profile.go:168, profile.go:172, profile.go:176, profile.go:183
- A fresh bind sweeps leftover `about:blank`/`chrome://newtab/` tabs so tab count tracks session count. profile.go:232
- `close --all` kills every profile browser; profiles (cookies) survive. profile.go:273, main.go:280
- Chrome discovery order: `--chrome`, `AGENT_WEBMCP_CHROME`, `CHROME_PATH`, then platform paths / PATH lookup. chrome.go:12, chrome.go:17
- Chrome 149+ is required. chrome.go:53, main.go:381
- Launch flags include `--enable-features=WebMCP,WebMCPTesting` and `--remote-allow-origins=*`. chrome.go:67, chrome.go:59
- Headless launch is `--headless=new --hide-scrollbars --window-size=1440,900`. chrome.go:75
- `AGENT_WEBMCP_CHROME_FLAGS` appends extra launch flags. chrome.go:69
- `open` never auto-relaunches a headless browser to go headed; it errors `headed_mismatch`. browser.go:30
- `auth handoff` is the one caller allowed to kill and relaunch the profile browser headed. auth.go:240, browser.go:32

### Engine parity (a written contract)

- Parity is a contract in AGENTS.md, not a hope: both engines must offer the judge the same operations for the same page. AGENTS.md:36
- Four clauses: hide password/file/hidden fields, name an unnamed control after its role, offer a dropdown one action per option, and make a filled field or a ticked box visible to `fingerprintSnap`. AGENTS.md:37
- Three of the four were violated and are now fixed; a test sits behind each clause. AGENTS.md:40, engine_test.go:161, engine_test.go:173, engine_test.go:202, engine_test.go:217
- `TestBuildStateRedactsOnBothEngines` pins that redaction is identical on either engine. engine_test.go:341
- The docs site states the same contract. website/app/docs/configuration/page.tsx:59

### LP data facts (the ones that are easy to get wrong)

- `LP.getInteractiveElements` reports `type` as `native` for every element: a text input, a password field, a checkbox and a submit button alike. It cannot tell them apart. lightpanda.go:212, lightpanda.go:230
- Never switch on that `type` field. `lpInteractive.Type` exists in the struct but nothing reads it. lightpanda.go:219, lightpanda.go:469
- `LP.getNodeDetails`, called once per element, carries what the headline method does not: `inputType`, live `value`, `checked`, the full `options` behind a `<select>`, and `selector`. lightpanda.go:224, lightpanda.go:233
- The snapshot reads both methods: `getInteractiveElements` for the element list, `getNodeDetails` for the per-element facts. lightpanda.go:338, lightpanda.go:366
- A failed `getNodeDetails` read is not fatal: the element is still offered from role and tag, because a failed read must not hide a usable control. lightpanda.go:362, lploop.go:186
- The loop reads the same per-element details, so observe and the loop cannot diverge on what an element is. lploop.go:178, lploop.go:188

### Lightpanda engine (read-only paths)

- Launch shape mirrors agent-browser: `serve --host 127.0.0.1 --port N`. lightpanda.go:6
- `--load-resources stylesheet` and `iframe` are passed, because computed style is what visibility checks read; without it every element looks hidden. lightpanda.go:122, lightpanda.go:126, lightpanda.go:119
- Binary resolution: explicit path, `PATH`, `~/.lightpanda/lightpanda`, `~/.local/bin/lightpanda`. lightpanda.go:89, lightpanda.go:96, lightpanda.go:102
- Readiness is a poll of `/json/version` over HTTP, and Lightpanda does serve it; the WS URL comes from its `webSocketDebuggerUrl`. lightpanda.go:190, lightpanda.go:191
- An early child exit is checked before the probe, so a crash reports its own error instead of hanging. lightpanda.go:185
- stdout/stderr are drained into a bounded 40-line ring buffer; an unread child pipe would block the child on write. lightpanda.go:29, lightpanda.go:145
- Startup timeout 10s, poll interval 100ms. lightpanda.go:27, lightpanda.go:28
- `captureSnapshotLP` launches, uses and kills the process inside one call: LP starts instantly, and a fresh process cannot leak the previous run's state. lightpanda.go:420, lightpanda.go:425
- `lpSnapshot` creates a target blank, attaches flattened, then navigates and polls `document.readyState`; the LP domain reports an empty document for an unattached page. lightpanda.go:248, lightpanda.go:258, lightpanda.go:281, lightpanda.go:286
- `lpCall` writes the CDP frame directly because `dialCDP`'s `Call` has no `sessionId` parameter and LP requires it. lightpanda.go:393, lightpanda.go:400
- `lpInteractive` mirrors only the fields the CLI needs; `name` can be null and `type` is `native` for ordinary controls. lightpanda.go:214, lightpanda.go:212
- `lpBuildSnapshot` is the one element-to-action mapping, shared by observe, crawl and the loop so they cannot drift. lightpanda.go:392, lightpanda.go:380
- LP action ids are `lp<backendNodeId>`. lightpanda.go:417
- A password, file or hidden field is never offered to the judge on LP, matching observeJS. lightpanda.go:249, lightpanda.go:402
- An unnamed control falls back to its role, then to its href, the same order observeJS uses. lightpanda.go:410, lightpanda.go:405
- A `<select>` is offered one action per unselected option, read from `getNodeDetails`, so no `--params` is needed. lightpanda.go:421, lightpanda.go:424
- `--params` remains the fallback for a select that came with no options. lploop.go:279, lploop.go:282
- A toggle's action value carries `checked` as `"true"`/empty, because a checkbox's own value does not change when it is ticked and the fingerprint reads the value slot. lightpanda.go:445, lightpanda.go:441
- There are no scroll actions on LP: there is no layout to scroll. lightpanda.go:390
- The LP guard holds tag, role, href and inputType, never a value, so an act may change a value without tripping its own freshness check. lightpanda.go:458
- `lpKind` reads `inputType` first, then role, then tag; checkbox, radio, submit, button, image and reset are clicks. lightpanda.go:472, lightpanda.go:474
- `observe --engine lightpanda` returns the LP snapshot with `engine` and `untrusted` set. observe.go:234, observe.go:237, observe.go:274
- `observe --engine lightpanda` takes the page from the URL argument, else from where the session last was; there is no session to ask. observe.go:243, observe.go:245
- `crawlCmdLightpanda` reports controls, links, forms, inputs, native and custom tools as `null` plus an `unavailable` list, so a reader can tell "not measured" from "measured, found none". crawl.go:137, crawl.go:152, crawl.go:156
- `lpPageURL` and `lpEvalString` read URL and title back through the attached session; the LP payloads carry neither. lightpanda.go:469, lightpanda.go:445, lightpanda.go:302
- `lpValueString` reads a string-valued evaluate; `lpJSONValue` reads a list or object. lightpanda.go:492, lightpanda.go:475
- LP has no persistent cookie jar: no `--user-data-dir`, cookies load read-only via `--cookie` and save on exit via `--cookie-jar`. engine.go:69

### Lightpanda loop (the fused run)

- `lpLoop` owns the process and the one CDP connection; whoever starts it must close it. lploop.go:30, lploop.go:51
- The live page travels on `ctx` via `withLPLoop`/`lpLoopFrom`, so nothing above the browser boundary gained a parameter. lploop.go:42, lploop.go:46
- `startLPLoop` launches, dials, creates a target, attaches flattened, and holds the connection open. lploop.go:70, lploop.go:82, lploop.go:92, lploop.go:104
- The LP loop applies the URL policy before navigating. lploop.go:119
- `waitReady` polls `document.readyState` on a soft deadline: an SPA never reports complete and the snapshot is what the loop reads. lploop.go:135, lploop.go:146
- `lpLoop.observe` returns the same `snapshot` struct as Chrome, so `buildState` and therefore PII redaction are unchanged. lploop.go:154, lploop.go:152
- `lpLoop.observe` reads URL and title by `Runtime.evaluate` and text from `LP.getMarkdown`. lploop.go:165, lploop.go:168, lploop.go:172
- `lpLoop.nodeDetails` is the per-element `getNodeDetails` pass, shared by observe and the loop. lploop.go:188, lploop.go:181
- `lpSelector` resolves a node to a CSS selector through `LP.getNodeDetails`; the selector is the only handle that survives a navigation, because `backendNodeId` does not. lploop.go:208, lploop.go:209, lploop.go:205
- `actLP` mirrors `actExecute`: same operations, same text rules, same freshness gate, same receipts. lploop.go:266, lploop.go:262
- `actLP` is reached from `actExecute` when the ctx carries a live LP page; the Chrome path is unchanged. act.go:358, act.go:355
- LP clicks and fills by node id, so no geometry is needed. lploop.go:340, lploop.go:344
- `actLP` refuses INVOKE as `engine_unsupported` rather than pretending; the LP domain does expose `WebMCP.invokeTool` but no site has been driven through it here. lploop.go:249, lploop.go:252
- On LP a select has no LP command: it is set through the resolved selector and read back, so a silent no-op is an error. lploop.go:320, lploop.go:327
- A select's option value normally travels in the snapshot, so the agent supplies no flag; `--params` is only the no-options fallback. lploop.go:279
- `verifyFill` reads a filled field back through its selector, because `fillNode` reports success for a node it could not write. lploop.go:387, lploop.go:384
- LP receipts carry `engine: lightpanda` and the resolved selector when one was found. lploop.go:370, lploop.go:374
- `lastSeenURL` reads the session's saved snapshot for the page to open. lploop.go:405, lploop.go:406

### Observation

- `observeJS` is one page-side IIFE that returns actions, guards, page key, and visible text. observe.go:18
- Node identity lives in `window.__jevFast` (ids WeakMap + nodes Map) and survives across ticks. observe.go:20
- Observable roles: button, link, checkbox, radio, switch, tab, menuitem, menuitemradio, option, gridcell, combobox, textbox, searchbox, spinbutton. observe.go:55
- Elements are skipped when hidden, disabled, `aria-disabled`, outside the viewport, or zero-size. observe.go:91, observe.go:93
- The visibility gate is in-page JS, not a CDP call: `checkVisibility` and `getBoundingClientRect`. observe.go:29, observe.go:92
- The text harvest filters to the viewport by measuring a `Range`, so no text survives without layout. observe.go:123
- Selects expand to one `select` action per enabled option. observe.go:99
- Editable fields emit both a `fill` action and a `click` "Open <label>" action. observe.go:113
- Actions are capped at 250; the overflow is reported as `omitted_actions`. observe.go:135
- Synthetic actions are appended: `scroll_down`, `scroll_up`, `wait`. observe.go:138, observe.go:142
- Visible text is capped at 6000 characters. observe.go:128
- Guards capture identity, role, name, value, checked, selectedIndex, readOnly, disabled, aria attrs, href, and up to 6000 chars of the enclosing scope text. observe.go:80
- `fingerprintSnap` is sha256 over URL + text + scrollY + every action id/kind/label/value, truncated to 16 hex chars. observe.go:180, observe.go:189
- `scan-cache.json` is written by `observe`, not by `decide`. observe.go:192, observe.go:264

### Jev (the paid judge)

- Endpoint `https://api.typesafe.ai/v1/systemone`; BYOK only, key read from `TYPESAFE_API_KEY`. jev.go:27, jev.go:81
- No key: decide/tick refuse with `no_key`; the free tier keeps working. decide.go:153, jev.go:103
- Model from `TYPESAFE_MODEL`, default `jev-latest`. jev.go:85
- HTTP client timeout 25s; up to 3 attempts with 500ms doubling backoff. jev.go:25, jev.go:110, jev.go:112
- Retryable statuses: 408, 429, 529, and 500-599. jev.go:92
- One POST carries the operation head, every per-op target head, and the `goal_complete` noul. decide.go:260, decide.go:236
- Four prompt heads: `jevNextAction`, `jevTarget`, `jevGoalComplete`, `jevExplore`. jev.go:29, jev.go:43, jev.go:56, jev.go:50
- Eight operations with labels: CLICK, TYPE_TEXT, SELECT, SCROLL, INVOKE, WAIT, DONE, BLOCKED. jev.go:64
- `goalCompleteThreshold` is 0.7; at or above it the operation is rewritten to DONE. jev.go:62, decide.go:300
- Jev state is redacted: elements carry index, kind, role, label, and a `filled` boolean; values never leave the snapshot. decide.go:107, decide.go:117
- State carries the last 10 recorded actions and the last 12 visited URLs. decide.go:141, decide.go:141
- `constrain` refuses unoffered operations and unoffered targets; drift is telemetry (`anomaly`), never a silent substitution. jev.go:153, decide.go:318

### Decision

- `decideOnce` order: key check, snapshot, bot wall, login wall, tab, tool list. decide.go:153, decide.go:156, decide.go:160, decide.go:163, decide.go:172
- Bot wall returns `bot_wall`; login wall returns `auth_required` with the handoff remedy inline. decide.go:161, decide.go:164
- The page-tool lookup is skipped when there is no Chrome tab; an empty tool set is the honest answer and `actLP` refuses INVOKE to match. decide.go:167, decide.go:170, decide.go:177
- Offered operations come from the snapshot action kinds via `opsForKind` (click, fill, select, scroll). decide.go:55, decide.go:193
- The synthetic `wait` action is never an operation. decide.go:183
- INVOKE is offered only when the page registered at least one tool; its targets are the page tool names. decide.go:210, decide.go:215
- Loop tools are deliberately not offered to decide; loop-in-loop reentrancy is deferred. decide.go:206, looptools.go:19
- WAIT and DONE are always offered; BLOCKED is withheld when `forceExplore` is set. decide.go:219, decide.go:227
- Every target head also offers an explicit `none`. decide.go:224
- A chosen `none` triggers one forced-exploration re-decide, then an honest BLOCKED at confidence 0.5. decide.go:302, decide.go:304
- Operation and target are argmax over probabilities restricted to the offered set, falling back to the raw choice. decide.go:267, decide.go:268
- Evidence: `decisions.jsonl` appends `kind: decision` records; `last-snapshot.json` holds the goal, decision, snapshot, and tools. decide.go:30, decide.go:34, decide.go:41, decide.go:51
- Both evidence files are written 0600 inside a 0700 session dir. decide.go:40, decide.go:46, decide.go:52
- `decide` never acts; it only saves. decide.go:14
- History reads are run-scoped when a run id is present, so an earlier run's success cannot read as this attempt's evidence. act.go:134

### Act

- `actCmd` deletes the saved snapshot after executing: a decision runs at most once; a retry must re-decide. act.go:325, act.go:342
- `checkFresh` is the freshness gate, extracted so both engines call one implementation: fingerprint equality, then the target node's guard equality. act.go:154, act.go:155, act.go:158
- `actLP` calls `checkFresh` for every kind including select; Chrome exempts select because its guard holds value and selectedIndex, which the act itself changes. lploop.go:329, lploop.go:325
- DONE and BLOCKED require a fresh snapshot whose fingerprint matches the decided one, else `stale`. act.go:376, act.go:377
- A target missing from the decided snapshot is `stale`. act.go:425
- Geometry is never in the decision: `resolveJS` scroll-then-measures just before input and hit-tests with `elementFromPoint`. act.go:18, act.go:35, act.go:29
- Occluded or off-viewport hits retry twice with scroll offsets for sticky headers. act.go:37, act.go:40
- A detached node is re-registered by stable key: id, href, placeholder, name, label text. act.go:52, act.go:57, act.go:60
- Fill: click, select-all (`modifiers` 2, 4 on darwin), `Input.insertText`, then read back the live value. act.go:520, act.go:532, act.go:537, act.go:543
- If synthetic input stalls or lands different text, `domSetText` sets the value with the native setter and fires `input`. act.go:269, act.go:540, act.go:545
- `valuesEquivalent` compares intent, not bytes: scheme, trailing slash, case, and spaces are normalized. act.go:249
- Text comes from the calling agent via `--text` and is cached per field across stale retries within a tick. act.go:450, act.go:456
- Missing text returns `text_needed`; missing tool params return `args_needed`. act.go:453, act.go:392
- INVOKE validates required schema args from `--params` before calling. act.go:398
- SELECT sets a native dropdown by option value; unconfirmed mutation stops as `select_unconfirmed`, never retried as a stale read. act.go:581, act.go:607
- `settleJS` waits up to 200ms for combobox options, otherwise two frames / 50ms. act.go:95, act.go:97
- Targets are normalized: a human `@e1` from `observe` prints bare `e1` on the wire. act.go:345, act.go:577
- `appendExecuted` stamps `kind: executed`, adds the run id when present, and writes 0600. act.go:167, act.go:168, act.go:173

### Policy (acceptance)

- `terminalConfidenceFloor` 0.7: below it DONE/BLOCKED do not terminate as success. policy.go:16
- `uncertainStopFloor` 0.6: below it a stop is uncertainty, not impossibility. policy.go:21
- `acceptTerminal`: DONE passes on either the goal_complete head or the operation-choice head; BLOCKED only on the operation head. policy.go:28, policy.go:33
- `needsExploreRetry`: true for low-confidence BLOCKED/WAIT, or a DONE that `acceptTerminal` refuses. policy.go:45, policy.go:49, policy.go:52
- `retryUncertainStop` re-decides once with BLOCKED unoffered and mandatory-explore rules; shared by `decide` and `tick` so the paths cannot drift. policy.go:58, decide.go:87, tick.go:68
- Thresholds are code-owned and fit to loop data, not theory. policy.go:8

### Tick and run

- `tick` is the fused step: one snapshot, one Jev call, one execution, in one process. tick.go:10, tick.go:42
- At most 2 attempts; a stale execution re-decides against the fresh page, twice-stale returns `stale`. tick.go:49, tick.go:88, tick.go:93
- `marginRetryFloor` 0.25: a low-margin actionable call gets one fresh-eyes re-decide and the higher-confidence answer wins. tick.go:17, tick.go:57, tick.go:60
- `page_changed` is a fingerprint comparison of the before and after snapshots. tick.go:75
- `run --max-steps` defaults to 30 and is clamped to 1..60. run.go:20, run.go:22
- `run` forwards `--text` and `--params` into the loop; it used to accept both flags and drop them, so a fill goal could never complete on `run`. run.go:50
- `runLoop` gained a `params` parameter, so a select carries its value the way text carries a fill's. run.go:85, run.go:84
- The loop-tool call site passes `""` for params; loop tools carry values in the goal template. looptools.go:111
- Stuck budget: 3 consecutive no-change steps, excluding WAIT and INVOKE. run.go:114, run.go:116
- Budget exhaustion returns BLOCKED, not DONE. run.go:123
- A refused terminal returns BLOCKED with an "unconfirmed stop" reason, never success. run.go:110, run.go:111
- `text_needed` / `args_needed` stop the run as BLOCKED with reason "needs agent: ...". run.go:64
- `auth_required` from a run returns exit 2 with the handoff remedy. run.go:69, auth.go:113
- DONE is a claim: the caller is told to verify independently. run.go:12, run.go:135
- `runLoop` is shared by `run` and loop tools. run.go:85, looptools.go:111

### URL policy

- `AGENT_WEBMCP_ALLOWED_DOMAINS` and `--allowed-domains` are the only navigation controls. engine.go:141, main.go:157
- An empty allowlist allows everything, which keeps every existing invocation working; the policy is opt-in. engine.go:101, engine.go:138
- Matching is case-insensitive host globs: `*` any, exact host, or a parent domain, so `example.com` also covers `sub.example.com`. engine.go:115
- Same semantics as `customToolsForHost`, deliberately. engine.go:113
- A deny is reported as `url_not_allowed` so a caller can tell it from a network failure. engine.go:133, engine.go:123
- An empty URL is an attach, not a navigate, and passes. engine.go:126
- Checked before the navigation is spent. browser.go:25, crawl.go:57
- Checked again on the landed URL, because `Page.navigate` follows redirects and an allowed host can land the tab anywhere. browser.go:103, browser.go:101
- The landed-URL failure names both hosts. browser.go:104
- Lightpanda checks once, before navigating; it has no tab to re-read. lploop.go:119

### Pinning

- The binding is a file, `profile\ntargetID`, not process memory. profile.go:139, profile.go:143
- `bindSessionTab` reuses the bound tab while it is alive and creates a fresh tab only when it is not; the stickiness is in code, not a flag. profile.go:210, profile.go:214
- A fresh bind sweeps leftover `about:blank` / `chrome://newtab/` tabs. profile.go:232
- `killProfileBrowser` deletes the port file, so after a restart `sessionTarget` fails `no_browser`. profile.go:130, profile.go:172
- There is no re-resolution by stable identity and no auto-relaunch outside `open`: `ensureProfileBrowser` is reached only from `bindSessionTab`. profile.go:206, profile.go:79
- A dead binding is a reported state, not an error to fix. main.go:321, main.go:338
- Lightpanda has no session-to-tab binding at all: one process, one connection, one page, held for the loop. lploop.go:30, lploop.go:92

### Browser backend (Chrome coupling)

- Chrome discovery order: explicit, `AGENT_WEBMCP_CHROME`, `CHROME_PATH`, platform paths, PATH. chrome.go:12, chrome.go:17
- Chrome launch args hardcode `--user-data-dir`, `--enable-features=WebMCP,WebMCPTesting`, `--headless=new --window-size=1440,900`, trailing `about:blank`. chrome.go:56, chrome.go:60, chrome.go:67, chrome.go:75, chrome.go:77
- Discovery is Chrome's HTTP endpoint set: `/json/version`, `/json/list`, `PUT /json/new`, `/json/close/<id>`. cdp.go:63, cdp.go:50, profile.go:224, profile.go:263
- Tab identity is the `webSocketDebuggerUrl` field of `/json/list`. cdp.go:20, profile.go:179
- Lightpanda also serves `/json/version`, so readiness reuses the same probe; its per-page work goes through `Target.createTarget` plus a flattened `Target.attachToTarget`, not through `/json/new`. lightpanda.go:190, lightpanda.go:248, lightpanda.go:258
- Complete CDP call-site set in the package: WebMCP (8 methods), `Runtime.evaluate`, `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`, `Page.enable` / `navigate` / `loadEventFired`, and on LP `Target.createTarget` / `Target.attachToTarget`. webmcp.go:108, webmcp.go:113, webmcp.go:354, tools.go:82, act.go:520, act.go:530, act.go:537, browser.go:72, browser.go:76, lightpanda.go:248
- There are no screenshots anywhere in the CLI or the site; no `Page.captureScreenshot` call exists.
- Headed coupling: `--start-maximized`, the `headed` stamp file, the `headed_mismatch` refusal, and handoff's kill-and-relaunch. chrome.go:73, profile.go:44, browser.go:31, auth.go:240

### Page tools (WebMCP)

- Discovery calls `WebMCP.enable`, then `WebMCP.listTools` as the fast path. webmcp.go:108, webmcp.go:113
- Chrome 149-152 have no listTools: the fallback drains `toolsAdded`/`toolsChanged`/`toolsRemoved` events, returning 300ms after the last arrival within a 1500ms cap. webmcp.go:12, webmcp.go:131, webmcp.go:139
- Invocation sends `{frameId, toolName, input}`, takes `invocationId`, then waits for `WebMCP.toolResponded`; it retries once as `WebMCP.callTool` on older builds. webmcp.go:329, webmcp.go:354, webmcp.go:367
- A tool name in more than one frame errors and asks for `--frame`. webmcp.go:270
- Chrome-only: the verbs are refused on LP at the gate, and `actLP` refuses INVOKE. main.go:226, lploop.go:252
- `list` tags custom tools by session-recorded names, not by page output. main.go:390, customtools.go:306

### Custom tools (page JS)

- A custom tool file is page JS that registers tools through the page's own `document.modelContext`. customtools.go:15
- Registry is `~/.agent-webmcp/tools/<name>.js` + `<name>.json`. customtools.go:50, customtools.go:600
- `toolMeta` carries name, hosts, file, added, verified/verifiedAt/testUrl, plus loop fields (kind, goal, params, fillParam, maxSteps, confirm, expect). customtools.go:26
- Kind defaults to `page`; a non-loop tool with no file is skipped at load. customtools.go:96, customtools.go:99
- Host match is exact, `*.suffix`, or `*`. customtools.go:107, customtools.go:113
- `open` auto-injects only verified tools; unverified tools load only through `tools load`. customtools.go:124, customtools.go:456, main.go:250
- Injection reads `ok:<tool>` lines from the evaluated file to learn registered names. customtools.go:360
- Per-session injected names are recorded in `tools.json` for provenance. customtools.go:134, customtools.go:308
- A full navigation drops per-document registrations, so `ensureCustomTools` silently re-injects on `invoke` and inside `decideOnce`. customtools.go:394, main.go:499, decide.go:180
- `tools verify` on a page tool reloads the page first, then injects, then lists, and stamps verified. customtools.go:711, customtools.go:719, customtools.go:734
- `tools list --query` searches the whole registry with no session; live native tools stay session-scoped. customtools.go:535, customtools.go:532
- `list --query` on a page ANDs space-separated substrings over name + description and returns exact callable signatures. main.go:414, main.go:439

### Loop tools (bounded Jev run)

- A loop tool has no JS file: a goal template with `{{param}}` holes, executed by the shared `runLoop`. looptools.go:12, looptools.go:15
- `{{param}}` substitution regex accepts `[A-Za-z0-9_-]`; a missing param is `bad_params`-style `missing params`, never a guess. looptools.go:22, looptools.go:49
- Every declared param is required; a missing or blank one returns `args_needed`. looptools.go:90
- Step budget: caller flag, else tool metadata, else 8; clamped to 30. looptools.go:100, looptools.go:105, looptools.go:107
- The TYPE_TEXT value is `fillParam`, else the first required param. looptools.go:74
- `expect` markers (`text_contains`, `url_contains`) certify the outcome in code after the run. customtools.go:216, customtools.go:222
- Text markers match full `document.body.innerText`, not the viewport-clipped snapshot. customtools.go:234
- `tools verify NAME --params ...` runs the tool and stamps verified iff the expect markers hold. customtools.go:251, customtools.go:276, customtools.go:282
- `invoke` routes loop tools before the page path. main.go:489

### Codemode (`execute`)

- `execute` runs a JS program in goja against the session's tool catalog: `tools.*` and `batch()` are the only externals. execmode.go:21, execmode.go:22, execmode.go:108, execmode.go:110
- No fetch, no fs, no timers, no imports; the program gains no authority. execmode.go:22
- The program is IIFE-wrapped, so a top-level explicit `return` is required. execmode.go:178
- Calls are synchronous; `batch()` is concurrent in Go with ordered results, capped at 8 items. execmode.go:109, execmode.go:32
- `--max-calls` defaults to 10, clamped to 1..50, and counts batch items too. execmode.go:287, execmode.go:121
- A fresh runtime per execution: no state leaks between programs. execmode.go:78
- The catalog is live page tools plus host-matched loop tools. execmode.go:191, execmode.go:233
- A loop tool with `confirm` refuses inside `execute`: a program cannot pause mid-run for a human. execmode.go:246
- An `auth_required` inside a program is retyped to exit 2 with the handoff remedy. execmode.go:37, execmode.go:334
- Program timeouts map to code `timeout`. execmode.go:331
- Chrome-only: refused at the engine gate. main.go:226

### Search

- `search` ports opencode codemode ranking: tokenize, naive singulars, then 20 (exact path) / 8 (path substring) / 4 (description) / 2 (full text) weights, summed per term. searchcmd.go:64, searchcmd.go:78
- Tokenizer splits camelCase and drops `*`. searchcmd.go:26, searchcmd.go:31
- Singular forms: strip trailing `es` (len>3) then `s` (len>2). searchcmd.go:41
- Scope is registry plus, only when `--session` was explicitly passed, the session's live tools; live entries win name collisions. searchcmd.go:249, searchcmd.go:213, searchcmd.go:220
- Results page with `--limit` (default 10, max 50) and `--offset`, and report `remaining` + `next`. searchcmd.go:154, searchcmd.go:163, searchcmd.go:270
- `--namespace HOST` filters by host. searchcmd.go:108
- When live session tools are included, the envelope is marked `untrusted`. searchcmd.go:279
- The live half hard-fails `webmcp_unsupported` without a WebMCP domain, which is why it is Chrome-only. searchcmd.go:205, searchcmd.go:208

### Auth and the vault

- Gates: index anonymously, escalate at use time. `probe` is read-only and always exits 0 with a state stamp; `handoff` pauses for a human. auth.go:14, auth.go:161
- `authStamp` states: logged_in, anonymous, unknown, no_session, unreachable. auth.go:69
- Stamps are machine-local at `<home>/auth/<host>.json`. auth.go:57, auth.go:76
- `handoff` kills the profile browser, relaunches headed on the login URL, notifies via `notify-send`, and polls until the wall clears. auth.go:240, auth.go:241, auth.go:254, auth.go:264
- Handoff wait defaults to 300s, clamped 30..1800. auth.go:221, auth.go:227, auth.go:230
- `detectLoginWall`: URL markers decisive, text markers need 2 hits. auth.go:31, auth.go:54
- `detectBotWall`: same shape, 2 text hits. customtools.go:427, customtools.go:446
- Vault: AES-256-GCM. Key is 32 random bytes in `<home>/.vault-key` (0600); `AGENT_WEBMCP_VAULT_KEY` (64 hex) overrides it. authvault.go:86, authvault.go:58, authvault.go:59
- Associated data binds the profile name, so entries cannot be swapped between profiles. authvault.go:139
- `vault.json` is 0600 in a 0700 dir. authvault.go:116, authvault.go:125
- `auth save` requires a secret from `--password-stdin` or `--password` and refuses an empty one. authvault.go:363, authvault.go:374
- Profile names must match `^[A-Za-z0-9_-]+$`. authvault.go:170, authvault.go:343
- `auth login <name>` decrypts in process and fills the form in-page; values never leave the page JS. authvault.go:195, authvault.go:250, authvault.go:281
- History for a vault login records metadata only (`user_set`, `pass_set`, `submitted`), never values. authvault.go:308
- `auth show` returns metadata and `hasPassword`; it never opens the secret. authvault.go:444
- Chrome-only: `auth` is refused on LP because handoff needs headed mode. main.go:228, engine.go:71

### Crawl

- `crawl <url>` is one invocation: open, snapshot, recon, WebMCP list, link/form harvest, login-wall check, in one envelope. crawl.go:11, crawl.go:42
- Deterministic code crawls; Jev judges in a separate call. crawl.go:14
- `reconJS` inventories up to 150 visible named controls and flags bot-defense markup in the first 400KB of HTML. tools.go:121, tools.go:134
- Link harvest caps at 80 entries; the cap is applied to the map, never by slicing the string. crawl.go:25, crawl.go:18
- The Chrome envelope is marked `untrusted`: title, link text and gate verdicts are page-derived. crawl.go:119, crawl.go:117

### MCP stdio server

- `mcp` speaks newline-delimited JSON-RPC 2.0 on stdin/stdout; stdout is protocol only, logs go to stderr. mcp.go:13, mcp.go:235, mcp.go:214
- Advertised protocol version `2025-11-25`, accepting 2024-11-05, 2025-03-26, 2025-06-18. mcp.go:20, mcp.go:22
- Six core tools: open, list_tools, invoke_tool, observe, close, tools_profiles. mcp.go:56, mcp.go:171
- `tools/call` dispatches in-process against the same internals the CLI verbs use, so the surfaces cannot drift. mcp.go:16, mcp.go:282
- `--tools core|all` both resolve to the same set today. mcp.go:220, mcp.go:169
- The MCP server applies the same URL policy as the CLI. mcp.go:54

### Doctor

- `doctor` runs seven checks: version, chrome, sessions, typesafe_key, registry, vault, and one live headless open+close of example.com on a throwaway session. doctor.go:28, doctor.go:30, doctor.go:37, doctor.go:46, doctor.go:52, doctor.go:65, doctor.go:76
- Key presence is reported as a bool, never the value. doctor.go:46
- Exit 0 all-pass, 1 any fail. doctor.go:106, doctor.go:108
- No Lightpanda check exists in doctor; the engine is verified only by the tests and a live `run`. doctor.go:28, lploop_test.go:19

### Tests

- Pure policy tests, no browser: explore-retry cases and run-scoped evidence reads. policy_test.go:11, policy_test.go:92, policy_test.go:170
- Loop goal rendering and value equivalence. looptools_test.go:10, looptools_test.go:23
- Search tokenizer and singular forms. searchcmd_test.go:7, searchcmd_test.go:21
- Exec sandbox: leaves, batch, auth and confirm markers, caps. execmode_test.go:11
- MCP core tool set completeness and the `agent_webmcp_` prefix. mcp_test.go:8, mcp_test.go:28
- Evidence files must be 0600 inside a 0700 session dir. perm_test.go:8
- Vault roundtrip uses a temp home plus an env key; no test touches the real `~/.agent-webmcp`. authvault_test.go:11
- Target normalization keeps tool names untouched. target_test.go:5
- Engine parsing, every gate refusal, refusal text naming a remedy, LP kind vocabulary, LP guards holding no value, LP fill changing the fingerprint, host allow matching, URL policy. engine_test.go:9, engine_test.go:42, engine_test.go:77, engine_test.go:92, engine_test.go:119, engine_test.go:159, engine_test.go:173, engine_test.go:203
- `TestLPLoopHoldsPageAcrossSteps` pins the disconnect behaviour that justifies refusing the split verbs; if LP ever stopped resetting the page, that test fails and the gate can be lifted. lploop_test.go:72, lploop_test.go:14
- Other live LP tests: observe usability, freshness gate, selector resolution. lploop_test.go:35, lploop_test.go:117, lploop_test.go:168
- LP tests skip without the binary, found via `AGENT_WEBMCP_LIGHTPANDA` or `/tmp/opencode/lightpanda`. lploop_test.go:19, lploop_test.go:21

### Known defects

- `appendExecuted` had two writers per action (`actExecute` plus
  `tickOnce`); fixed in `f246932`, which moved ownership to the caller:
  `logExecuted` for split `act`, `tickOnce` with `page_changed` for the
  fused loop (both engines). act.go:167, tick.go:82
- The lightpanda.go header comment still says "Read-only: crawl, observe, search. Never act.", which contradicts lploop.go. lightpanda.go:3
- The comment above `TestBuildStateRedactsOnBothEngines` still names `lpStampValues`, which no longer exists; the live value now arrives via `getNodeDetails`. engine_test.go:338

### Open parity gaps (known, deliberately not closed)

- Chrome does not make a checkbox tick visible to `fingerprintSnap`. `observeJS` puts `e.checked` in the page key, but `fingerprintSnap` reads URL, text, scrollY and action id/kind/label/value, not the page key. A toggle-only run on Chrome can still read as stuck and stop itself after three correct toggles. Left open because changing the Chrome fingerprint needs loop data, and thresholds are fit to loop data, not theory. observe.go:79, observe.go:180, observe.go:186, AGENTS.md:132
- Chrome pairs every editable with an extra `Open <label>` click; Lightpanda has no such pairing. The consequence is that the LP loop cannot open a widget that must be opened before it can be typed into. observe.go:113, lightpanda.go:390

### Verified on this machine (not a code fact)

- WebMCP works on this machine's Chromium 152, but that build has no `WebMCP.listTools`; `listWebMCP` falls through to its event path and works. webmcp.go:113, webmcp.go:149
- `document.modelContext.registerTool` and `.getTools()` are the real page-side API and both exist.

### Generated artifacts (never source)

- Per-profile: `browser-port`, `browser.pid`, `headed`, `chrome.log`. profile.go:42, profile.go:43, profile.go:44, profile.go:99
- Per-session: `target`, `decisions.jsonl`, `last-snapshot.json`, `scan-cache.json`, `tools.json`. profile.go:140, decide.go:31, decide.go:35, observe.go:193, customtools.go:135
- Session dirs are created 0700; evidence inside them 0600. decide.go:40, customtools.go:320
- Lightpanda writes nothing to the profile tree: its process, port and connection live only in memory for the duration of the call or the loop. lightpanda.go:420, run.go:44

## Files covered

<!-- The agent writes here. One row per file it describes. -->

| File | Hash | Told about |
|---|---|---|
| cmd/agent-webmcp/act.go | 8dc21d13d086 | agent-webmcp |
| cmd/agent-webmcp/auth.go | 58022e31fb9f | agent-webmcp |
| cmd/agent-webmcp/authvault.go | 279592e6d040 | agent-webmcp |
| cmd/agent-webmcp/authvault_test.go | 40bbc99f55fc | agent-webmcp |
| cmd/agent-webmcp/browser.go | 4310fa8262ff | agent-webmcp |
| cmd/agent-webmcp/cdp.go | a457b5e5a8a3 | agent-webmcp |
| cmd/agent-webmcp/chrome.go | 44ebc8680951 | agent-webmcp |
| cmd/agent-webmcp/commands.go | 7e666d175c44 | agent-webmcp |
| cmd/agent-webmcp/crawl.go | 3a9ebd64d0ec | agent-webmcp |
| cmd/agent-webmcp/customtools.go | fe1bb2b8f9ea | agent-webmcp |
| cmd/agent-webmcp/decide.go | b9c4588b0ff0 | agent-webmcp |
| cmd/agent-webmcp/doctor.go | a7b1461badcd | agent-webmcp |
| cmd/agent-webmcp/engine.go | 31dc5f141bc3 | agent-webmcp |
| cmd/agent-webmcp/engine_test.go | bcb7ea332421 | agent-webmcp |
| cmd/agent-webmcp/execmode.go | 070317514065 | agent-webmcp |
| cmd/agent-webmcp/execmode_test.go | 2b545c12c46b | agent-webmcp |
| cmd/agent-webmcp/jev.go | fe1567dbca8a | agent-webmcp |
| cmd/agent-webmcp/lightpanda.go | 9f1d8e9aec30 | agent-webmcp |
| cmd/agent-webmcp/looptools.go | 3a16cc9fcd12 | agent-webmcp |
| cmd/agent-webmcp/looptools_test.go | a8c7267c0f6b | agent-webmcp |
| cmd/agent-webmcp/lploop.go | fe4474c61257 | agent-webmcp |
| cmd/agent-webmcp/lploop_test.go | d581e34a2232 | agent-webmcp |
| cmd/agent-webmcp/main.go | 432e2b563ea5 | agent-webmcp |
| cmd/agent-webmcp/mcp.go | db2596894ff6 | agent-webmcp |
| cmd/agent-webmcp/mcp_test.go | d868ea00672b | agent-webmcp |
| cmd/agent-webmcp/observe.go | e9e3ec6b86b6 | agent-webmcp |
| cmd/agent-webmcp/output.go | 1bf88191f167 | agent-webmcp |
| cmd/agent-webmcp/perm_test.go | a482ea794911 | agent-webmcp |
| cmd/agent-webmcp/policy.go | 7f5093b59972 | agent-webmcp |
| cmd/agent-webmcp/policy_test.go | 1291a4463808 | agent-webmcp |
| cmd/agent-webmcp/profile.go | a36eeeb40719 | agent-webmcp |
| cmd/agent-webmcp/run.go | 86cbdfe88eea | agent-webmcp |
| cmd/agent-webmcp/searchcmd.go | eaa19fa3be70 | agent-webmcp |
| cmd/agent-webmcp/searchcmd_test.go | 4f21e7775d38 | agent-webmcp |
| cmd/agent-webmcp/session.go | a50847abec39 | agent-webmcp |
| cmd/agent-webmcp/target_test.go | fbab425e131b | agent-webmcp |
| cmd/agent-webmcp/tick.go | 28710758e1f2 | agent-webmcp |
| cmd/agent-webmcp/tools.go | ac8ca238fc04 | agent-webmcp |
| cmd/agent-webmcp/webmcp.go | 501d868befe7 | agent-webmcp |
| go.mod | b30c602db9e4 | agent-webmcp |
| .gitignore | 9ec5ef3156b9 | agent-webmcp |
| AGENTS.md | 726ae0d9048d | agent-webmcp |
| website/AGENTS.md | b0db7c39c182 | agent-webmcp |
| website/app/docs/configuration/page.tsx | 2435dd4edee9 | agent-webmcp |
| website/app/docs/security/page.tsx | e54f833a8352 | agent-webmcp |
| website/package.json | fc1e3514acd1 | agent-webmcp |

Hash is the first 12 characters of `sha256sum`. Told about lists the agents to
tell when this file changes. Use `agent-webmcp` for this repo.

## Agents to tell

- `agent-webmcp` — this repo
