# webmcp-troubleshooting — error codes and failure recovery

Companion to the `agent-webmcp` skill core. Load when any command fails.

| Symptom | Recovery |
|---|---|
| `no_session` | No live browser under this `--session` name. `open` first; check the spelling. |
| `no_page` | Browser is up with no page target. `open <url>` to create one. |
| `webmcp_unsupported` | Browser lacks the WebMCP CDP domain (old build, some mobile/remote targets). Move to Chrome ≥149 or Brave/Chromium ≥151-base. |
| `list` empty on a tool page | SPA registers late. Wait for load, re-`open` the URL, `list` again. |
| `tool 'x' not found` | Names are case-sensitive; the page may have re-registered under another frame. `list` again and pass `--frame`. |
| `timed out waiting for tool response` | Page JS hung or animation-gated. Raise `--timeout-ms`, then read state — partial application is common. |
| `params must be a JSON object` | The shell ate the quoting. Write the object to a file, pass `--params @file`. |
| Headed window missing | Session launched headless — `close`, then `open --headed`. Headless hosts have no display; stay headless there. |
| `cdp_unreachable` | Chrome died (OOM, killed externally). `close`, `open` again; `chrome.log` in the session dir has the cause. |
| `timed out waiting for chrome CDP` | Chrome never came up. Read the `chrome.log` tail in the error: a sandbox crash in rootless containers/Docker/CI means relaunch with `AGENT_WEBMCP_CHROME_FLAGS="--no-sandbox"`. `chrome not found` instead means set `--chrome`/`AGENT_WEBMCP_CHROME`. |

General rule: one retry with adjusted input, then report the failure plus the last readout — never loop a failing call hoping the page changes its mind.
