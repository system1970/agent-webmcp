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
