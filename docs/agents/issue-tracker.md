# Issue tracker: Local Markdown

Issues and specs live as markdown files in `.scratch/`.

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is a `Status:` line near the top of each issue file (see `triage-labels.md`)
- Comments append at the bottom under a `## Comments` heading

## Wayfinding operations

- **Map**: `.scratch/<effort>/map.md`
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md` with the question in the body; `Type:` records `research`/`prototype`/`grilling`/`task`; `Status:` records `claimed`/`resolved`
- **Blocking**: a `Blocked by: NN, NN` line near the top
- **Frontier**: open, unblocked, unclaimed files in `issues/`; first by number wins
- **Claim**: set `Status: claimed` before any work
- **Resolve**: append the answer under `## Answer`, set `Status: resolved`, append gist + link to the map's Decisions-so-far
