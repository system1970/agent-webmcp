# Agentic CLI vs MCP: what makes a CLI agentic (read 2026-10-09)

Sources, primary unless marked [S]: MCP spec `2026-07-28`
(`modelcontextprotocol.io/specification/latest`, `schema/2026-07-28/schema.ts`),
MCP client best-practices (`.../docs/2026-07-28/develop/clients/client-best-practices`),
MCP authorization (`.../specification/2026-07-28/basic/authorization`);
Anthropic engineering: *Code execution with MCP* (2025-11-04), *Writing effective tools
for agents* (2025-09-11), *Advanced Tool Use* (2025-11-24), *Claude Skills* docs
(`platform.claude.com/docs/en/agents-and-tools/agent-skills/overview`), Claude Code best
practices + permissions docs; Cloudflare `blog.cloudflare.com/code-mode` (2025-09-26)
and `/code-mode-mcp` (2026-02-20); POSIX Shell Command Language §2, GNU Coding Standards
§4.8, clig.dev, no-color.org; vendor CLI docs — `cf` (`developers.cloudflare.com/cf/agents`),
`gh` (`cli.github.com/manual/{gh_help_formatting,gh_help_exit-codes,gh_help_environment}`),
Stripe (`docs.stripe.com/cli`, `/cli/agent/setup`), Vercel (`vercel.com/docs/cli`,
`/docs/cli/global-options`), `gws` (`github.com/googleworkspace/cli`), Kraken
(`github.com/krakenfx/kraken-cli`), `ccloud`
(`cockroachlabs.com/blog/cockroachdb-ai-agents-cli-database-automation`), AWS
(`docs.aws.amazon.com/cli/latest/userguide/cli-usage-output-format`), kubectl
(`kubernetes.io/docs/reference/kubectl/conventions`), Netlify (`docs.netlify.com/cli`);
Simon Willison *Introducing Showboat and Rodney* (2026-02-10) + `simonw/{showboat,rodney}`
READMEs; benchmarks — Scale Labs `labs.scale.com/blog/mcp-vs-cli` (2026-07-08), ScaleKit
`scalekit.com/blog/mcp-vs-cli-use` + `github.com/scalekit-inc/mcp-vs-cli-benchmark`
(2026-03-11) [vendor, see §2 caveats], arXiv:2604.00073 *Terminal Agents Suffice for
Enterprise Automation* (2026-03-31, preprint). Agent-CLI standards [S/community, not normative]: aclig.dev v0.4,
`brettdavies/agentnative` v0.4.0, `Johnixr/agent-cli-guide`, Tumf's 7 principles
(dev.to, 2026-02-06). Repo facts re-verified in `src/{cli,main,failure}.ts`,
`src/budgets.ts`, `src/spill.ts`, `src/tools/{registry,search,execute}.ts`,
`src/commands/{mcp-serve,skill}.ts`, `skills/agent-webmcp/SKILL.md`, `package.json`.
Sections marked **synthesis** are our reasoning, not sourced claims.

## 1. Three layers, not two rivals

An API is the stateless request-response transport underneath everything. A CLI wraps
it in verbs, flags and auth handling. MCP sits above the API too — a model-facing
discovery-and-invocation layer. None is a substitute for the others; a serious MCP
server is backed by an API, and a vendor CLI is backed by the same API. Framing this as
"CLI versus MCP" asks the wrong question; the useful question is *what does an agent
need in order to finish a task without a human in the loop*, and where does each
surface supply it.

**"Agentic CLI" names a pre-existing property, newly guaranteed.** The Unix substrate
already provides exit codes as the machine-readable success channel (POSIX §2: `$?`
"expands to the decimal exit status of the most recent pipeline"), the stdout/stderr
split ("Error messages are usually written on standard error"), pipe composability
(clig.dev quoting McIlroy: "Expect the output of every program to become the input to
another, as yet unknown, program"), TTY detection, and idempotency. What is new in
2025–26 is that vendors now *document these as an agent contract* rather than a
scripting convenience:

- Cloudflare `cf`: "Commands return JSON and describe their own inputs, so an agent can
  find and run the right command without prior knowledge of `cf`." / "When standard
  output is not a terminal, it contains only the result, so an agent can parse it or
  filter it with `jq` without extra flags."
- Vercel: "When the CLI detects that it is running under an agent, non-interactive mode
  is the default."
- Kraken: "stdout is always valid JSON on success, or a JSON error envelope on failure.
  Exit code 0 means success… stderr carries diagnostics only… Never parse stderr for
  data."

Four community standards now compete to formalize this — aclig.dev (10 invariants:
read-only by default, self-describing, token-bounded, injection-fenced, agent-completable
auth, append-only contract…), `brettdavies/agentnative` (8 RFC-2119 principles + an
`anc` linter and live leaderboard), `Johnixr/agent-cli-guide` (10 principles:
noun-verb grammar, long flags first, structured output as API contract, TTY-aware
behaviour, dry-run by default, semantic exit codes, input validation / hallucination
defence, idempotent operations, actionable errors, "help text is the agent's brain"),
and Tumf's 7 (machine-readable, non-interactive by default, idempotent & replayable,
safe-by-default, observable & debuggable, context-efficient, introspectable).

**These are not normative and disagree at the edges**, but they converge hard on the
same ~12 axes, and the convergence is the finding: the axis list in §6 is stable across
four independently-authored documents.

## 2. The token math — and why it is no longer the whole argument

### 2.1 What the eager-loading cost actually was

MCP's original model pushes every tool definition into context at connect. Anthropic
measured it and published the fix: presenting tools as a filesystem of typed wrappers the
agent explores "reduces the token usage from 150,000 tokens to 2,000 tokens — a time and
cost saving of 98.7%" (*Code execution with MCP*). Cloudflare measured the same shape
against its own API: 2,500+ endpoints as MCP tools "would consume 1.17 million tokens";
Code Mode collapses them into two tools (`search()`, `execute()`) in "around 1,000
tokens", "reduces the number of input tokens used by 99.9%" (measured with tiktoken).
Anthropic's *Advanced Tool Use* adds per-server accounting — GitHub 35 tools ≈ 26K
tokens, Slack 11 ≈ 21K, Sentry 5 ≈ 3K, Grafana 5 ≈ 3K, Splunk 2 ≈ 2K, "58 tools
consuming approximately 55K tokens before the conversation even starts" — and 134K
tokens of definitions internally before optimization.

A CLI's cost in that model is ~0 until invoked. Claude Code's own best-practices doc
says it plainly: "CLI tools are the most context-efficient way to interact with external
services… Claude is also effective at learning CLI tools it doesn't already know. Try
prompts like `Use 'foo-cli-tool --help' to learn about foo tool`." The mechanism is that
`--help` is progressive disclosure performed with text instead of YAML frontmatter, and
it is paid for only when read.

### 2.2 The two benchmarks that measured it — and one that dissolves it

**ScaleKit** (vendor, published with code) ran Claude Sonnet 4 on five read-only GitHub
tasks across CLI / CLI+~800-token skill / GitHub's official Copilot MCP server with all
43 tools loaded: medians of 1,365–9,386 tokens for CLI vs 32,279–82,835 for MCP, "MCP
costs 4–32× more", all differences p<0.05. Reliability: CLI 25/25, CLI+Skills 25/25,
MCP 18/25 (7 `ConnectTimeout` — "a TCP-level timeout… Not an MCP protocol error").
Their sharpest secondary finding: the 800-token skill file cut CLI tool calls by a third
and latency by a third, which they call "the best ROI in this entire benchmark."

*Caveats a careful reader will catch, and should:* the committed `report.md` shows
**68 runs, not 75**, with MCP at only **n = 18** (3+3+5+3+4 per task) and
`completion: 1.0` on every MCP run — i.e. the committed data contains no failures, so
the 72% figure exists only in the blog. The pre-registered methodology promised 30 runs
per agent per task with LLM-judge, Fleiss' kappa and CIs, none of which appear; several
Cohen's d values are degenerate (`-4482.10`), indicating zero-variance samples. Direction
is credible and consistent with Anthropic's own numbers; the specific multiples are a
vendor claim at n≈3–5.

**Scale Labs** is the methodologically strongest study and it cuts the other way. 50
long-horizon tasks, two environments (Env 1: 113 tools; Env 2: 140 tools and >30,000
artifacts), 50–100 tool calls per task, 11–49 human rubric criteria each, LLM-judged,
≥4 runs per condition, four conditions on *identical* backend tools — MCP-only,
CLI-only, **Both**, and **Hybrid** (bulk search/list via CLI; targeted reads/writes on
MCP).

Headline: "**Interface choice matters much less for the latest frontier models.**" On
Opus 4.8 and GPT-5.5, MCP-only, CLI-only, Both and Hybrid "all perform similarly." The
conditional effect appears on weaker models: Opus 4.6 on the data-heavy environment went
8.5% → 17.7% with CLI, while on the lighter environment MCP was *stronger* (7.3% →
11.8%). Their failure taxonomy explains why: with GPT-5.4 reasoning on, tool-selection
errors drop 20% → 7% and query-construction errors 36% → 16% versus reasoning off —
"CLI helps less capable models by reducing tool-use process errors, while more capable
models make far fewer of those errors… the bottleneck shifts to planning and coverage,
**which a better interface can't fix**."

And the cost table is a counterweight to the token story, because it shows *which*
interface is cheaper depends on the harness, not the protocol: Opus 4.8 via Claude Code
(which spills large MCP outputs to files) was cheaper on MCP ($2.84 vs $3.52/run);
GPT-5.5 via the OpenAI Agents SDK (which re-sends large MCP outputs inline) was cheaper
on CLI ($2.11 vs $3.51). CLI was 20–40% slower on wall clock and used ~2.6× more turns
in both. "So compare cost per solved task on your own stack rather than assuming one
interface is leaner, and **keep in mind that the harness can matter as much as the
interface**."

**arXiv:2604.00073** (*Terminal Agents Suffice for Enterprise Automation*, preprint) is
the strongest form of the CLI claim — "a coding agent equipped only with a terminal and
a filesystem can solve many enterprise tasks more effectively by interacting directly
with platform APIs… match or outperform more complex agent architectures at a fraction
of the cost" — and Scale Labs reads as the controlled rebuttal.

### 2.3 The routing result nobody expects

The most operationally important finding in either benchmark: **exposing both interfaces
does not produce smart routing.** Scale Labs, verbatim: "giving the agent both MCP and
CLI did not produce smart routing between the two interfaces. Models almost always fell
back to MCP and barely touched the CLI. A deliberate split that routes bulk search and
listing through CLI and keeps targeted reads and writes on MCP was the most reliable
configuration… **but the model did not figure that out. If you want the benefits of both,
encode the interface split yourself instead of leaving it to the model.**"

This is the axis the whole comparison turns on, and it is a *design* claim, not a
*transport* claim. For agent-webmcp it is directly load-bearing: §7 treats our
`search`-then-`list`-then-`execute` loop as exactly such an encoded split.

## 3. What MCP supplies that a CLI cannot

**Credential custody — but with an honest asterisk.** For HTTP transports MCP carries
OAuth 2.1 with PKCE, RFC 8707 resource indicators (tokens audience-bound, so a token
issued for one server cannot be replayed at another), RFC 9728 protected-resource
metadata, and DCR. Cloudflare's Code Mode server downscopes: "using Workers OAuth
Provider to downscope the token to selected permissions approved by the user when
connecting. The agent only gets the capabilities the user explicitly granted." The
sharpest version of the argument (Kenneth Sinder, who built Notion's hosted MCP) is
"the model can't leak a key it never holds."

The asterisk is in MCP's own spec: "Implementations using an STDIO transport **SHOULD
NOT** follow this specification, and instead retrieve credentials from the environment."
An stdio MCP server has *exactly* the credential-custody problem of a CLI. So the real
line is not CLI-vs-MCP, it is **shared-machine credential vs per-client scoped grant** —
and for a local single-operator binary that difference is small. Vendors on the CLI side
have also done real work here: Stripe stores credentials in the OS secure store behind a
server-side "MCP and CLI access" toggle; `gws` encrypts at rest (AES-256-GCM) with the
key in the OS keyring; `cf` uses `CLOUDFLARE_API_TOKEN` plus named profiles and
directory-scoped state; CockroachDB gives every agent "a distinct, traceable identity.
No shared tokens."

**Per-call permissioning.** The MCP spec is normative here in a way no CLI is: "there
SHOULD always be a human in the loop with the ability to deny tool invocations… Present
confirmation prompts to the user for operations", plus "Show tool inputs to the user
before calling the server". Tool annotations (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`) declare risk in the protocol, though the spec is blunt
that clients "should never make tool use decisions based on `ToolAnnotations` received
from untrusted servers" — the same stance our SKILL.md takes toward `readOnly`/
`untrustedContent` hints.

The CLI counter-evidence is Claude Code's own permissions doc, which is unusually
candid: "Bash permission patterns that try to constrain command arguments are fragile"
(`Bash(curl http://github.com/ *)` "won't match" reordered options, redirects,
variables), and a deny rule "covers the invocation Claude usually produces and **isn't a
security boundary around the program**." CockroachDB's answer is the strongest available
CLI-side rebuttal: the agent "couldn't [failover or delete a cluster], because the
service account it authenticates with only has read access… **The guardrails aren't in
the agent's prompt. They're in the permission model.**"

**Typed results and typed failure.** MCP defines `structuredContent` conforming to an
optional `outputSchema`, and splits errors into two channels: protocol errors ("models
are less likely to be able to fix") versus tool execution errors reported with
`isError: true`, which "contain actionable feedback that language models can use to
self-correct and retry". A CLI can approximate this — Kraken routes on a stable `error`
category with `retryable` + `docs_url` fields and explicitly says "Route on `error`, not
on `message`"; `gws` has a six-level exit taxonomy "so scripts can branch on the failure
type without parsing error output" — but there is no protocol layer that validates the
shape or distinguishes retryable from permanent. The convention must be invented,
documented, and maintained, and the client cannot verify it is honoured.

**Reach without a shell, and distribution.** Cloudflare states the limit of the CLI path
exactly: "Tools like OpenClaw and Moltworker convert MCP servers into CLIs using
MCPorter to give agents progressive disclosure. The limitation is obvious: **the agent
needs a shell, which not every environment provides** and which introduces a much
broader attack surface than a sandboxed isolate." Anthropic's Skills runtime has the
mirror constraint (no network access, no package installation, pre-configured
dependencies only). MCP reaches browser assistants, mobile, and hosted chat; a CLI
reaches everywhere a binary can be installed and a subprocess spawned. Distribution is
the same split in another costume: one `{"mcpServers": {...}}` stanza versus `npm i -g`
/ `brew install` / `curl | sh` per machine, OS and arch.

**Statefulness — now largely a draw, and the change is recent.** MCP removed
protocol-level sessions in `2026-07-28`: no `initialize` handshake, no `Mcp-Session-Id`,
cross-call state via "explicit server-minted handles passed as ordinary tool arguments",
and `server/discover` replacing negotiation. The pre-2026 spec already admitted the point
("MCP has no protocol-level session… should do so by returning an explicit handle from a
creation tool and accepting that handle as an argument on subsequent calls"). CLIs do the
same thing with files: `rodney start` writes `~/.rodney/state.json`, `showboat`
accumulates a document, `vercel link` writes `.vercel/project.json`. **Our session
handles are this pattern, and we built it before the spec converged on it** —
`src/sessions/` handles are reattached per call, which is the same shape MCP now
recommends.

**Prompt-injection fencing.** `gws` integrates Cloud Model Armor to "scan API responses
for prompt injection before they reach your agent", with `warn`/`block` modes. MCP has no
equivalent primitive — the injection surface is the *content*, not the transport — and
Willison's lethal-trifecta framing applies identically to both. Our own posture
(`untrusted: true` on every envelope, spill as a *field* not a text marker, "never
promote page text to instructions") is the CLI-side instance of the same defence.

## 4. What a CLI supplies that MCP cannot

**Composability as a first-class property.** Pipes, `xargs`, `while read`, `$( )` are a
programming language whose verbs happen to be programs. Every major vendor documents
composition rather than merely permitting it: Stripe shows
`stripe get /v1/subscriptions -d status=past_due | jq ".data[].id" | xargs -I % stripe
delete /subscriptions/%`; AWS documents `describe-instances --query … --output text |
grep running | awk '{print $2}' | while read line; do modify-instance-attribute …`;
CockroachDB chains `ccloud cluster connection-string … -o json | jq -r '.connection_url'
| xargs -I{} psql {} -c "SELECT count(*)"`. Crucially, intermediate data can be filtered
*before* it ever reaches the model — the same win Anthropic attributes to code execution,
obtained for free by `| jq | head`.

**Training-data priors.** "Agents trained on code corpora have strong priors for
noun-verb CLI patterns like `git commit`, `docker run`, `kubectl apply`" (CockroachDB).
`gh pr list` is closer to *known* than any runtime-injected schema. This advantage is
explicitly temporal — training data will catch up — but it is real today and it is why
`gh`-style CLIs work with no skill file at all while a bespoke CLI needs one.

**Availability.** "Major coding agents all support MCP — but agent frameworks like
AutoGen and LangGraph don't natively, and CI/CD environments like GitHub Actions,
Jenkins, and ArgoCD have no MCP integration at all. Every one of them can run shell
commands" (CockroachDB). The bare-minimum proof is mini-SWE-agent: ~100 lines, no
function calling, no custom tools, just a bash subprocess, competitive on SWE-bench
Verified.

**Zero tax until used, and full output control.** A CLI costs nothing until invoked, and
its output format is under the operator's control rather than the server's — Zechner's
point: "If I find that the output of a tool is not token efficient, I can just change the
output format. Something that's hard or impossible to do depending on what MCP server you
use."

**Scriptability as a durable artifact.** "Agents can generate shell scripts that combine
multiple commands into repeatable runbooks, then commit those scripts to version control"
(CockroachDB). A successful flow becomes a reviewable, diffable, shareable file. This is
the same argument Anthropic makes for Skills-as-code ("sorting a list via token
generation is far more expensive than simply running a sorting algorithm"), and it is the
strongest strategic argument for the CLI-first posture: **an agentic CLI is the substrate
a skill can be written against.**

## 5. The convergence — both sides learned the same lesson

The 2025–26 debate looks like a war but is mostly two houses rediscovering one insight:
**eager loading is the mistake, not the protocol.**

MCP's side of the convergence is now extensive and, notably, self-documented:

- MCP's own client best-practices page is titled "Patterns for scaling MCP host
  applications across many servers and tools" and states the problem in the CLI camp's
  terms: "Loading every tool definition into the model's context window upfront wastes
  tokens, increases latency, and degrades model performance." It prescribes **progressive
  tool discovery** (defer `tools/list` injection, expose a lightweight `search_tools`
  meta-tool, three layers: catalog → inspect → execute) and **programmatic tool
  calling**. Its alt-text repeats the headline: "~150,000 tokens on definitions alone,
  while progressive discovery uses ~2,000 tokens." It even supplies the threshold
  heuristic ("1%-5% of the context window") and warns about the prompt-cache trap:
  "Adding or removing tool definitions mid-conversation invalidates that cache, and the
  resulting miss can cost more tokens than the definitions you removed."
- Anthropic shipped it: **Tool Search Tool** (`defer_loading: true`, regex/BM25 variants,
  up to 10,000 deferred tools) reports ">85% reduction, loading only the 3–5 tools Claude
  needs", accuracy "Opus 4: 49% → 74%; Opus 4.5: 79.5% → 88.1%", and "Claude's ability to
  pick the right tool degrades once you exceed 30–50 available tools." **Programmatic
  Tool Calling** reports 43,588 → 27,297 tokens (−37%) and "+11% performance with 24%
  fewer input tokens" on BrowseComp/DeepSearchQA. Tool Use Examples moved parameter
  accuracy 72% → 90%.
- **Claude Code enables tool search by default**: "Only tool names and server
  instructions load at session start." Its `auto` mode is "Threshold mode… loads the
  tools it would otherwise defer upfront while their definitions total less than 10% of
  the context window, and defers all of them once the definitions reach 10%."
- **The spec itself moved**: `2026-07-28` is stateless and per-request negotiated;
  Sampling, Roots and Logging are deprecated; `server/discover` is mandatory; and an
  official **"Skills over MCP"** extension (SEP-2640) now exists to "Discover and read
  Agent Skills from MCP servers."

The CLI side converged too, and toward MCP's features rather than away from them. Sinder's
provocation — "a good CLI is MCP with extra steps. To make a command line work well for an
agent you end up reinventing, by hand, most of what MCP gives you for free: progressive
disclosure (a noun/verb hierarchy instead of a flat wall of flags, like the Stripe CLI),
consistent auth, token-efficient I/O, and a layer of skills to bind it all together" — is
confirmed by what vendors actually shipped. `cf` now has `cf cli search "create D1
database"` (local, credential-free, ranked JSON) and `cf schema d1 create` (an
OpenAPI-shaped description) across "more than 2,900 commands". Kraken ships
`agents/tool-catalog.json` (174 commands with parameter schemas and safety flags) and
`agents/error-catalog.json` (10 categories with retry guidance) *alongside* its `--help`.
`gws` builds its command surface dynamically from Google's Discovery Service and adds
`gws schema <method>`. Every one of these is a CLI reimplementing `tools/list`.

**And both houses converged on Skills as the abstraction over the transport**, which is
the durable outcome: Anthropic's three-level progressive disclosure (~100 tokens of
metadata / <5k of instructions / none until accessed), `gh skill`, `vercel skills`,
`stripe agent setup --skills`, `gws`'s 100+ bundled SKILL.md files, Kraken's 59,
Cloudflare's `cloudflare/skills` plugin. Cloudflare's own FAQ — "Should I use Skills, the
MCP server, a CLI, or all of them? **All three**" — is the vendor consensus, repeated
independently by Stripe, Vercel, CockroachDB and Kraken.

So the residual difference is *not* eager-versus-lazy discovery. Both sides solved that.
What remains, and what §3 and §4 list, is **custody and containment**: whose credentials,
who can approve a mutation, whether a result is typed, and whether the environment has a
shell.

## 6. So what makes a CLI agentic? (**synthesis**)

Two words are doing different jobs and the standards conflate them.

**Agent-friendly** is a property of *output*: the agent can parse what it reads. That is
necessary and cheap to get wrong.

**Agentic** is a property of the *loop*: **the agent can complete the task — discover,
act, verify, recover — with no human at the prompt.** This is the line Tumf draws with
"no confusion, no destruction, no blockage, repeatable, self-repairing", and it is the
line that makes a CLI a *tool* rather than a *documented program*. Every requirement
below exists to keep one of those five from failing.

The axes, consolidated from aclig.dev / agentnative / agent-cli-guide / Tumf and cross-
checked against `gh`, `cf`, Stripe, Vercel, `gws`, Kraken, AWS, kubectl, rodney,
showboat. Ordered by how often the agent's loop actually dies without them:

| # | Axis | The failure it prevents | Canonical evidence |
|---|---|---|---|
| 1 | **Never blocks.** No prompts, no pagers, no stdin waits, no TTY assumptions; `--non-interactive`/`--yes` fail explicitly rather than hang | Agent hangs forever with nobody to answer "Y/N?" | Stripe `--non-interactive` "activates automatically when standard input isn't a terminal"; Vercel "when the CLI detects… it is running under an agent, non-interactive mode is the default" |
| 2 | **Self-describing at runtime.** The command tree, schemas, exit codes and safety state are readable *as data*, on demand | Agent guesses flags, wastes turns probing | `cf schema`, `cf cli search`, `gws schema`, `gh --json` with no field list enumerates the fields, Kraken `agents/tool-catalog.json` |
| 3 | **Structured output as an API contract.** JSON/NDJSON on stdout; stdout = data, stderr = diagnostics, nothing else, ever | Downstream parse breaks; agent can `\| jq` safely | `cf`: "When standard output is not a terminal, it contains only the result"; Kraken: "Never parse stderr for data" |
| 4 | **Errors tell the agent what to do next.** Machine-readable code + remediation, not a traceback | Agent loops or gives up; retries the wrong thing | Kraken routes on `error`/`retryable`/`docs_url` and says "Route on `error`, not on `message`"; `gws`'s 0–5 taxonomy "so scripts can branch on the failure type without parsing error output"; platform.claude.com: "Return semantic, stable identifiers… rather than opaque internal references" [S for the "input validation failed / you provided 'abc'" phrasing, which is a secondary paraphrase of Anthropic's error guidance] |
| 5 | **Bounded output.** Truncation/pagination/projection by default; a pointer to the full body when cut | Context blows up mid-task; evidence destroyed | Anthropic: "restrict tool responses to 25,000 tokens by default"; joelclaw's truncate + file pointer; AWS `--output off` + `$?` |
| 6 | **Semantic exit codes.** Beyond 0/1, so retry-vs-fix-vs-escalate is decidable without parsing prose | Agent retries a config error forever | `gws` 0–5; rodney `0` success / `1` check-failed / `2` error; gh `4` = needs auth; **counter-example: `cf` exits 0 on an aborted destructive command without `--force`** |
| 7 | **Explicit mutation boundary.** Read-only is the default path; writes gated by a flag the agent can pass deliberately | Unattended agent destroys state | aclig.dev I2 "Read-only by default… Mutations are gated in the binary, not a wrapper"; `kubectl --dry-run=client`; Kraken `acknowledged=true` in guarded mode |
| 8 | **Idempotent and replayable.** Retries are safe; declarative verbs preferred | Duplicate charges, duplicate resources on retry | Stripe `--idempotency <key>` "preventing the same request from replaying within 24 hours"; `--if-exists skip\|update\|error`; `vercel agent` marker-wrapped idempotent writes |
| 9 | **Injection-fenced.** Untrusted content is labelled so it is not followed as instructions | Agent exfiltrates or acts on page text | `gws --sanitize` (Model Armor, warn/block); our `untrusted: true` envelope |
| 10 | **Composable.** stdin/stdout, `-` convention, `\|`-friendly shapes | Agent serialises what it could have piped | McIlroy via clig.dev; every vendor pipe example in §4 |
| 11 | **Append-only contract.** Commands, flags and fields only ever get added | Scripts and skills break on upgrade | aclig.dev I6; adding an optional JSON field is safe, removing one is a major bump (agent-cli-guide) |
| 12 | **Headless-completable auth; secrets never on argv.** A real non-browser path; `--token-file`/stdin over flags | Dead end at login; secret in `ps` and shell history | `cf`: "Agents that run without a person present… cannot complete `cf auth login`. Set `CLOUDFLARE_API_TOKEN`"; Stripe `login --non-interactive` returning `browser_url`/`verification_code`/`next_step` as JSON; clig.dev "Do not read secrets directly from flags" |

**And the axis that is not on any list but should be: a skill.** Every vendor that got
adopted shipped one — `gh skill`, `vercel skills`, `stripe agent setup`,
`gws`'s bundled SKILL.md set, Kraken's 59, Cloudflare's plugin. A skill is the
*procedural* layer that tells the agent when to reach for which verb, and it is where the
tool's conventions live so they do not have to be re-derived each session. ScaleKit's
finding is the quantitative case: ~800 tokens of `gh` guidance cut tool calls and latency
by a third — "the best ROI in this entire benchmark."

The minimal complete instance of the whole set is showboat: one Go binary whose entire
interface is its `--help`, which Willison designed "to provide a coding agent with
*everything it needs to know*", with an explicit undo verb (`pop`) and a **verify
command that re-runs every block and exits 1 on mismatch** — i.e. a CLI that closes its
own loop. That is what "agentic" looks like in its purest form.

## 7. What it means for agent-webmcp (**synthesis**, repo facts at file:line)

We are the case study this debate is about: a CLI that also serves MCP, both doors
reading one registry (`src/tools/registry.ts:1`, dispatch `src/cli.ts:27`, serve
`src/commands/mcp-serve.ts:19`). Scored against §6:

**Already strong — and stronger than most of the standards demand**

- **Axis 3, stdout discipline.** `--json` is the machine door and every verb that emits
  data has it; usage lines print the flags (`src/cli.ts:91`). In `mcp serve` stdout is
  the protocol and diagnostics are stderr-only (`src/commands/mcp-serve.ts:15`), the same
  guarantee `cf` documents.
- **Axis 2, self-describing.** Help is a flat table of `usage + one-line description`
  per verb, with literal budget numbers printed rather than named
  (`execute [--timeout ms 1-300000]`, `src/cli.ts:91`). `skill show` prints the
  version-matched agent guide from the binary itself (`src/commands/skill.ts:2`), which
  is Kraken's `CONTEXT.md` pattern with the drift problem solved by embedding it.
- **Axis 2 + 5, progressive discovery done right.** `search` ranks by word overlap over
  names (3×) and descriptions, clamped 1–50 (`src/tools/search.ts:29`) with a *bounded*
  compact signature per hit — keys truncate at 64 chars, the whole signature at 256
  (`src/tools/search.ts:40`) — explicitly so "a hostile schema (giant names, thousands of
  props) must not bloat the discovery entry point." `list` then returns the one full
  record the call needs. Schemas ride the loop on demand and never up front
  (`skills/agent-webmcp/SKILL.md:196`). This is exactly the encoded routing split Scale
  Labs found the model will not discover for itself: search for discovery, list for
  shape, execute to act.
- **Axis 5, bounded with evidence preserved.** Results past budget *spill to disk* and
  return a structured `spill` field, never a silent cut, and "truncation destroys
  evidence" (`src/spill.ts:5`). Budgets are one debated block:
  `CHAR_BUDGET {min 1000, max 64000, fallback 8000}` (`src/budgets.ts:41`),
  `RUN_MAX_TOOL_CALLS 25` (`src/budgets.ts:16`), 30s per call, 8M-char final value. This
  is Anthropic's "restrict responses to 25,000 tokens" with the addition that neither
  house documents: **the pointer travels as a field, not text, because result text starts
  with attacker-controlled page output that can forge a marker.**
- **Axis 10, composition.** `execute` runs real JS against page tools — loops, branches,
  filters, one turn per flow (`src/tools/execute.ts:42`). Multi-session joins
  (`sesh.ALIAS.tools.*`) mean two origins compose in one program with data flowing
  through code, not through the model. SKILL.md already states the two-tier policy
  honestly ("Prefer harness codemode where it exists; this is the same shape for harnesses
  that can't run code") — which is the §5 convergence, already encoded.
- **Axis 9, injection fencing.** `untrusted: true` on every envelope plus a
  never-follow-it contract in SKILL.md. We match `gws`'s posture without its Model Armor
  dependency, and we are explicit that labels are provenance cues, not a boundary.

**Gaps, in the order they hurt an unattended agent**

1. **Axis 1 (mild)** — nothing blocks, but nothing *guarantees* it. `--json` is opt-in,
   not TTY-defaulted, and there is no `--non-interactive`/`--yes` flag. Today's default
   behaviour already never prompts, so this is a discoverability gap, not a hang risk.
   The fix is cheap and matches both `cf` and Vercel: default JSON when stdout is not a
   TTY, with `--plain`/`--no-json` to force rows.
2. **Axis 6** — exit codes are 0/2/1 and carry no semantics: `UsageError` → 2,
   `CliFailure` → 1, anything unexpected → 1 with a defect dump (`src/main.ts:11`). An
   agent cannot distinguish "bad flag, do not retry" from "browser died, retry", which is
   precisely the branch `gws` (0–5) and rodney (0/1/2) exist to make decidable. Note the
   trap `cf` documents — an exit code of 0 on an *aborted* destructive command — before
   designing this: our analogue is a `close` that reaped a browser we launched but found
   the foreign one already gone.
3. **Axis 7** — the two state-changing verbs (`register`, which mutates the session page,
   and `close`, which kills browsers) are not gated by a deliberate-write flag. Both are
   session-scoped, reattached per call, and recoverable by re-opening, so blast radius is
   small; but "close what you open" is currently a *convention in the skill* rather than a
   property of the binary.
4. **Axis 8** — no idempotency primitive. `register` re-registering a duplicate name
   fails loud (spec-shaped rejection, good), but there is no dedupe key and no
   `--if-exists` policy for the retry-after-timeout case an unattended agent will hit.
5. **MCP door drift (largest, and newly urgent).** We speak `@modelcontextprotocol/sdk`
   1.32.1 (`package.json:27`), pinned to the pre-`2026-07-28` spec. Our `tools/list`
   returns name + description + `inputSchema` only — no `outputSchema`, no
   `structuredContent`, no tool annotations, no `server/discover`. Meanwhile the protocol
   went stateless, and its own docs now prescribe progressive discovery and programmatic
   tool calling. **Our CLI door is ahead of our MCP door**, which is the inverse of the
   direction the ecosystem moved, and the §3 typed-result advantages
   (`structuredContent` + `isError`) are ones we could adopt cheaply and currently do not.

**The strategic read.** The research does not say "ship CLI, drop MCP"; it says the two
converged and the residual difference is custody and containment. Our shape — one
registry, two doors, a skill that names which composition to use — is the vendor consensus
(Cloudflare's "all three", Stripe's `agent setup`, Vercel's `agent`/`skills`/`mcp`). What
we uniquely already have that the CLI-first camp had to reinvent is the *engine*: script
composition, bounded+spilling results, per-origin trust labels, and discovery that cannot
be bloated by a hostile page. What we are missing is the boring agent-ergonomics tier
(TTY-defaulted JSON, semantic exit codes, a deliberate-write flag, an idempotency key)
that aclig.dev/agentnative/Tumf each enumerate and that `cf`, `gws` and Kraken all ship.
That tier is small, cheap, and it is what separates "a CLI an agent can drive" from "an
agentic CLI."

## 8. Not decided, and deliberately so

- Whether to default JSON on non-TTY (axis 1/3) — changes user-visible output for every
  scripted caller; needs the users.md stranger test and a one-in/one-out doc decision.
- A semantic exit-code taxonomy — must avoid the `cf` zero-on-abort trap and stay
  append-only; no number chosen here.
- gating `register`/`close` behind a deliberate-write flag — interacts with the
  accident-containment posture in `docs/run-accepted-risk.md`.
- Whether to upgrade the MCP door to `2026-07-28` (SDK 2.x) and add
  `outputSchema`/`structuredContent`/annotations. Note the prompt-cache trap MCP's own
  docs flag: adding or removing tool definitions mid-conversation can cost more than the
  definitions removed, so any change to `tools/list` output is not free.
- None of the four agent-CLI standards is normative; nothing here commits us to any of
  them. They are cited as convergent evidence for the axis list, not as a conformance
  target.




