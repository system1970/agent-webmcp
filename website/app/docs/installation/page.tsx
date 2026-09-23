import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Installation · agent-webmcp docs",
  description: "Install the binary and prove the browser path works.",
};

export default function InstallationPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Installation
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Two minutes: install the binary, confirm the version, open and close
        a page. If the third step works, everything downstream works.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Install the binary</h2>
      <CodeBlock
        code={`# Windows PowerShell
irm https://raw.githubusercontent.com/system1970/agent-webmcp/main/install.ps1 | iex

# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/system1970/agent-webmcp/main/install.sh | sh

# Or with Go (no installer needed)
go install github.com/system1970/agent-webmcp@v0.4.0`}
      />
      <h2 className="mt-8 text-xl font-medium text-ink">Confirm the version</h2>
      <CodeBlock code={`agent-webmcp version\n# expect: agent-webmcp 0.4.0`} />
      <h2 className="mt-8 text-xl font-medium text-ink">Prove the browser path</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        You need Chrome 149 or newer (Brave or Chromium on a 151-base works
        too). These two commands exercise the full path, browser launch to
        tab close:
      </p>
      <CodeBlock
        code={`agent-webmcp open example.com --session setup-check\nagent-webmcp close --session setup-check`}
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        <code className="font-mono text-[13px] text-ink">chrome not found</code>{" "}
        means pointing at the binary yourself: retry with{" "}
        <code className="font-mono text-[13px] text-ink">--chrome &lt;path&gt;</code>{" "}
        or export{" "}
        <code className="font-mono text-[13px] text-ink">AGENT_WEBMCP_CHROME=&lt;path&gt;</code>.
        Zen and Firefox have no CDP support, so a hanging{" "}
        <code className="font-mono text-[13px] text-ink">open</code> almost
        always means the wrong browser.
      </p>
    </article>
  );
}
