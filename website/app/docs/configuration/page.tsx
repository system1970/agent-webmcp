import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Configuration · agent-webmcp docs",
  description: "Flags, environment variables, defaults. No config file.",
};

export default function ConfigurationPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Configuration
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        There is no config file. Precedence is simple: explicit flags beat
        environment variables beat built-in defaults.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Environment</h2>
      <CodeBlock
        code={`TYPESAFE_API_KEY            ultrafast tier (required for decide/act/tick/run)
TYPESAFE_MODEL              judge model (default jev-latest)
AGENT_WEBMCP_SESSION        default session (default "default")
AGENT_WEBMCP_PROFILE        browser profile (default "shared")
AGENT_WEBMCP_HOME           state root (default ~/.agent-webmcp)
AGENT_WEBMCP_CHROME         browser binary (fallback: CHROME_PATH, then PATH)
AGENT_WEBMCP_CHROME_FLAGS   extra Chrome flags (appended)
AGENT_WEBMCP_VAULT_KEY      64 hex chars (else generated machine-local key)`}
        lang="text"
      />
      <h2 className="mt-8 text-xl font-medium text-ink">Engines</h2>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Chrome is the default. Lightpanda is a from-scratch headless engine: it
        starts instantly and uses far less memory, and it runs the autonomous
        loop. It has no layout engine, so element boxes are approximate and
        anything that hit-tests input stays on Chrome. Lightpanda resolves a
        node by id instead, which is why it can act without geometry.
      </p>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        One rule decides what runs there: Lightpanda forgets the page when its
        CDP connection closes. The split verbs observe in one process and act in
        the next, so on Lightpanda the second process would find a blank page.
        <code>run</code> holds one connection for the whole loop, which is why it
        works and <code>decide</code>, <code>act</code> and <code>tick</code>{" "}
        do not. Give <code>run</code> the page as an argument.
      </p>
      <CodeBlock
        code={`agent-webmcp crawl <url> --engine lightpanda
agent-webmcp run example.com --goal ".." --text ".." --engine lightpanda --executable-path /path/to/lightpanda`}
        lang="bash"
      />
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Refused on lightpanda: <code>decide</code>, <code>act</code>,{" "}
        <code>tick</code> (use <code>run</code>), <code>list</code>,{" "}
        <code>invoke</code>, <code>execute</code> (WebMCP page tools are not
        verified there), <code>auth</code> (needs headed), <code>close</code>{" "}
        (no profiles).
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">URL policy</h2>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        <code>--allowed-domains</code> refuses navigation to any host outside the
        list. It is opt-in: an empty list means no restriction. The check runs
        before navigation and again on the landed URL, so an allowed host cannot
        redirect the tab somewhere else. <code>example.com</code> covers its
        subdomains; <code>*.example.com</code> covers subdomains only.
      </p>
      <CodeBlock
        code={`agent-webmcp open example.com --allowed-domains example.com
AGENT_WEBMCP_ALLOWED_DOMAINS=example.com agent-webmcp mcp`}
        lang="bash"
      />
      <h2 className="mt-8 text-xl font-medium text-ink">Defaults that matter</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Per-call timeout 30s (<code className="font-mono text-[13px] text-ink">--timeout-ms</code>).
        Headless 1440×900; headed starts maximized. Loops:{" "}
        <code className="font-mono text-[13px] text-ink">run</code> 30 steps
        (cap 60), loop tools 8 (cap 30), search 10 hits (cap 50), execute 10
        calls (cap 50). State lives under{" "}
        <code className="font-mono text-[13px] text-ink">AGENT_WEBMCP_HOME</code>:
        sessions (bindings + evidence), tools (registry), profiles (browsers).
      </p>
    </article>
  );
}
