---
name: hello.echo
version: 0.1.0
---
# hello.echo

Example plugin: proves the manifest → verb → sandboxed JS loop.

## Workflow

1. `plugin list` — hello.echo appears with scope repo.
2. `echo <words>` — returns them as JSON.
3. `plugin show hello.echo` — manifest, skills, verb sources.

## Gates

- Disable with `AGENT_WEBMCP_PLUGINS=-hello.*`.
