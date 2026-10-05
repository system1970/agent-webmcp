# Plugins

One directory per plugin. The binary holds still; capability lives here.

## Layout

```
my-plugin/
  plugin.json   manifest: id, version, engine, permissions, contributes
  main.js       verb programs (sandboxed JS, explicit return required)
  SKILL.md      playbook: workflow, inputs, outputs, gates
  tools/*.js    crafted page tools (listed, installed explicitly)
```

## Manifest

```json
{
  "id": "acme.compare",
  "version": "1.2.0",
  "engine": "^0.1.0",
  "permissions": ["network"],
  "contributes": {
    "verbs": [{"name": "compare", "help": "one line for a model reader", "run": "./main.js"}],
    "tools": ["./tools/*.js"],
    "skills": ["./SKILL.md"]
  }
}
```

- `id`: chars `a-z 0-9 . - _`. `core.*` reserved.
- `engine`: must match the binary (0.x compares minor too).
- `permissions`: `browser network secrets fs spawn`. Unknown refuses the plugin.
- `run`: path inside the plugin dir. `..` escapes refused.

## Scopes

| Dir | Scope | Loaded |
|---|---|---|
| `./plugins/*/` | repo | dev |
| `~/.agent-webmcp/plugins/*/` | user | always |
| `<cwd>/.agent-webmcp/plugins/*/` | project | only with `AGENT_WEBMCP_TRUST_PROJECT=1` |

First plugin id wins. Built-in verbs always win: collisions are refused,
never overrides. A broken manifest warns on stderr and is skipped.
Boot never writes and never fails on plugins.

## Verbs

Verbs run in the codemode sandbox: `args` (`{all, positional, flags}`)
plus the session page-tool catalog (`tools.*`, `webmcp.search/describe`,
`batch`). No fetch, no fs. Without `--session` the catalog is empty and
the verb still runs. Scaffold one:

```bash
agent-webmcp plugin new acme.compare   # ~/.agent-webmcp/plugins/
agent-webmcp plugin new acme.compare --here  # ./plugins/ (repo dev)
agent-webmcp plugin show acme.compare
```

Disable: `AGENT_WEBMCP_PLUGINS=-acme.*` (namespace) or `-acme.compare` (id).

## Example

`hello-echo/`: manifest → `echo` verb → sandboxed JS → JSON out.
`plugin list` shows it with scope repo; `-hello.*` removes it.
