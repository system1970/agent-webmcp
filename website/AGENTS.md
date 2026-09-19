# site — Next.js docs site

Next.js 16 + React 19 + Tailwind 4. `dev`/`build`/`start`/`typecheck` in `package.json`.

## Rules

- Prefer retrieval-led reasoning: check installed `next` version docs before writing App Router code.
- `npm run typecheck` (`tsc --noEmit`) clean before `npm run build`.
- The site is the CLI's docs only: install, verbs, custom-tool authoring. No catalog,
  no skills pages, no hosted service — those concepts live in Orkestrate now.
