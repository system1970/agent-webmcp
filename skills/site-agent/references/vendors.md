# Vendor catalog (disclosed reference for `site-agent` Phase A)

Fingerprint the vendor during the panel-hunt: the vendor predicts the whole panel family — trigger shape, streaming signal, history model, and which gate to expect. Check the site against this catalog before writing selectors.

## Mintlify docs (supermemory.ai/docs, exa.ai/docs, …)

- Trigger: `#assistant-entry` (desktop) or `#assistant-entry-mobile` (≤1024px); only the displayed one works.
- Input: textarea `Ask a question...`; submit sits two levels above the input with no shared form — ascend, don't assume siblings.
- Streaming: Mintlify swaps the send button OUT of the DOM for a separate `Stop generating` element. Detect streaming by the stop element's presence, not by label on the send button.
- `data-assistant-state` lies — verify visibility through controls.
- Gate: `/docs/_mintlify/assistant/siteconfig` (EdDSA-signed) carries one hCaptcha sitekey shared fleet-wide. Deterministic "error generating a response" on every tenant from one sandbox IP = `gated-here`; keep the pack, re-probe from a human IP.

## Inkeep docs (Claude docs)

- Markers: `INKEEP-PORTAL` element at body level, `api.inkeep.com/v1/challenge` in resources.
- Challenge failure from headless Chromium = `gated-here`. Same bucket as Mintlify: pack later, retry from a human-shaped browser.

## Shopify custom (shopify.dev/docs)

- Markers: `DevAssistant.isOpen` in localStorage, `_ChatBot` / `_ChatView` / `_ScrollArea` panel.
- Verbs present: `Ask assistant` trigger, `Submit prompt`, `New chat`, `Chat history`, `Close Assistant`, Yes/No answer feedback.
- Transcript and input live in separate subtrees; several containers share class fragments — rank read candidates by text length.
- History list survives `New chat` and CLI sessions (server-side): clear clears the visible transcript, not the record.

## vgpu/eve-style Ask AI (vgpu.sh, eve.dev)

- Markers: visible textarea + Submit in a form, `n / 1000` counter.
- Completion signal: Submit→Stop→Submit aria flip. Text-stability alone lies (mid-stream re-renders).

## Gate forensics (any vendor)

Fingerprint before blaming the overlay: identical challenge config across tenants, hcaptcha/recaptcha/turnstile scripts plus invisible challenge frames, deterministic refusal on every tenant from one IP. A fleet-wide refuse is environmental, not a pack bug. Record `gated-here`, keep the pack as-is.

## Flag forensics

Page-embedded feature flags are existence evidence, not wrappability proof. Stripe ships `docs_disable_conversational_layer:false` in its beacon with zero visible trigger headless → `unproven, not no`: re-probe from a human IP before classifying.
