import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Troubleshooting · agent-webmcp docs",
  description: "Honest codes, exit split, and the wedged-browser drill.",
};

export default function TroubleshootingPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Troubleshooting
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Exit 2 is dispatch failure (unknown verb). Exit 1 is call failure
        with an honest code:{" "}
        <code className="font-mono text-[13px] text-ink">usage</code>,{" "}
        <code className="font-mono text-[13px] text-ink">not_found</code>,{" "}
        <code className="font-mono text-[13px] text-ink">stale_target</code>,{" "}
        <code className="font-mono text-[13px] text-ink">no_browser</code>,{" "}
        <code className="font-mono text-[13px] text-ink">no_session</code>,{" "}
        <code className="font-mono text-[13px] text-ink">policy_denied</code>,{" "}
        <code className="font-mono text-[13px] text-ink">timeout</code>,{" "}
        <code className="font-mono text-[13px] text-ink">tool_failed</code>.
      </p>
      <CodeBlock
        code={`{"ok":false,"code":"stale_target","error":"stale_target: covered by overlay"}
# remedy: observe again, then act on the fresh ref
{"ok":false,"code":"no_session","error":"no_session: no such session demo"}
# remedy: open the session first`}
        lang="json"
      />
      <h2 className="mt-8 text-xl font-medium text-ink">
        Wedged browser
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        A browser can answer while its renderers are dead (
        <code className="font-mono text-[13px] text-ink">load timeout</code> on
        a fast site). <code className="font-mono text-[13px] text-ink">open</code> detects
        a dead tab and relaunches once, by itself. If timeouts persist, kill
        everything and start clean — each profile leaves a{" "}
        <code className="font-mono text-[13px] text-ink">chrome.log</code> as
        evidence:
      </p>
      <CodeBlock code={`agent-webmcp-rs close --all`} lang="bash" />
      <h2 className="mt-8 text-xl font-medium text-ink">
        Version skew
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        A running <code className="font-mono text-[13px] text-ink">mcp</code> server
        keeps serving the binary it started with. After reinstalling, compare{" "}
        <code className="font-mono text-[13px] text-ink">version</code> revs —
        reinstall with <code className="font-mono text-[13px] text-ink">scripts/install-local.sh</code>,
        which verifies the match.
      </p>
    </article>
  );
}
