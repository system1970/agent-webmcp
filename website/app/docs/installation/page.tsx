import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Installation · agent-webmcp docs",
  description: "Build the Rust CLI, install it safely, verify the version.",
};

export default function InstallationPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Installation
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Needs Chrome or Chromium 149+ on PATH and Rust 1.85+. One binary,
        no runtime.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Build and install
      </h2>
      <CodeBlock
        code={`cd rust && cargo build
scripts/install-local.sh   # quiesce live servers, atomic replace, verify rev`}
        lang="bash"
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The installer stops live{" "}
        <code className="font-mono text-[13px] text-ink">mcp</code> servers by
        exact process identity (never pattern matching), replaces the binary
        atomically, and verifies the installed rev matches the built commit.
        It confirms before killing live servers unless passed{" "}
        <code className="font-mono text-[13px] text-ink">--force</code>. The
        harness respawns MCP servers on demand.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Verify
      </h2>
      <CodeBlock
        code={`agent-webmcp version
# {"version":"0.1.0","rev":"<commit>"}
agent-webmcp plugin list | head -c 300`}
        lang="bash"
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The install lands at{" "}
        <code className="font-mono text-[13px] text-ink">~/.local/bin/agent-webmcp</code>.
        The <code className="font-mono text-[13px] text-ink">rev</code> field
        proves which commit serves — compare it after every install.
      </p>
    </article>
  );
}
