import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Installation · agent-webmcp docs",
  description: "Install agent-webmcp and check the browser in two commands.",
};

export default function InstallationPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Installation
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        No Go required. Pick your platform, confirm the version, then check
        the browser.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Install</h2>
      <CodeBlock
        code={`# Windows PowerShell
irm https://raw.githubusercontent.com/system1970/agent-webmcp/main/install.ps1 | iex

# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/system1970/agent-webmcp/main/install.sh | sh

# Or with Go
go install github.com/system1970/agent-webmcp@v0.4.0`}
      />
      <h2 className="mt-8 text-xl font-medium text-ink">Confirm</h2>
      <CodeBlock code={`agent-webmcp version\n# expect: agent-webmcp 0.4.0`} />
      <h2 className="mt-8 text-xl font-medium text-ink">Check the browser</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Chrome 149 or newer (or Brave/Chromium on a 151-base or newer). One
        open and one close proves the whole path:
      </p>
      <CodeBlock
        code={`agent-webmcp open example.com --session setup-check\nagent-webmcp close --session setup-check`}
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        <code className="font-mono text-[13px] text-ink">chrome not found</code>{" "}
        means locating the binary and retrying with{" "}
        <code className="font-mono text-[13px] text-ink">--chrome &lt;path&gt;</code>{" "}
        (or exporting{" "}
        <code className="font-mono text-[13px] text-ink">AGENT_WEBMCP_CHROME=&lt;path&gt;</code>
        ).
      </p>
    </article>
  );
}
