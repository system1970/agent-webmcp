# Task battery — generalizing Jev browser-use (all read-only, no accounts/purchases)

Run with keys loaded: `set -a; source ~/agent-webmcp/.env.local; set +a`
plus `TEXT_MODEL_API_KEY=$INCEPTION_API_KEY TEXT_MODEL_BASE_URL=https://api.inceptionlabs.ai/v1 TEXT_MODEL=mercury-2.5`.
Traces land in `traces/*.jsonl`.

| # | Site | Goal | Exercises |
|---|------|------|-----------|
| 1 | docs.typesafe.ai | Open homepage, reach the Confidence page, stop at its heading | docs IA, sidebar nav |
| 2 | books.toscrape.com | Open catalogue, go to page 2, open any book, stop at title+price | pagination, catalog, bot-friendly |
| 3 | news.ycombinator.com | Open top story's comments, stop at comment list | list disambiguation (story vs comments links) |
| 4 | github.com/browser-use/jev-ultrafast | Open repo, stop when README heading + star count visible | dense dynamic UI, logged-out |
| 5 | bbc.com | Open top story, stop at article headline (handle consent if shown) | consent dialogs, media site |
| 6 | en.wikipedia.org | Beyoncé → relativity of simultaneity, links only (DONE) | long-horizon routing |
| 7 | vercel.com/docs | Find the AI Gateway page via docs search, stop at its heading | search widget #2 (non-Wikipedia tech) |

Template:
```
node mini_loop.mjs --session perf2 --trace traces/<n>.jsonl --url <URL> --goal "<goal>" --max-steps 16
```
