# site — Next.js docs site

Next.js 16 + React 19 + Tailwind 4. `dev`/`build`/`start`/`typecheck` in `package.json`.

## Rules

- Prefer retrieval-led reasoning: check installed `next` version docs before writing App Router code.
- `npm run typecheck` (`tsc --noEmit`) clean before `npm run build`.
- Public skill index lives at `public/skills.json` — keep in sync when adding catalog skills.
