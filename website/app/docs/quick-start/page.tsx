import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Quick start · agent-webmcp docs",
  description: "Open, list, invoke, verify, close: the golden path in five commands.",
};

export default function QuickStartPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Quick start
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The golden path is always{" "}
        <code className="font-mono text-[13px] text-ink">
          open → list → invoke → verify → close
        </code>
        . Never invoke a tool you have not listed. One{" "}
        <code className="font-mono text-[13px] text-ink">--session</code> per
        task; <code className="font-mono text-[13px] text-ink">--json</code>{" "}
        for machine parsing.
      </p>
      <CodeBlock
        code={`agent-webmcp open https://webmcp.com --session setup-check
agent-webmcp list --session setup-check
# expect: about, surprise_me, share_on_x, ...
agent-webmcp invoke surprise_me --params '{}' --json --session setup-check
agent-webmcp close --session setup-check`}
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        An empty <code className="font-mono text-[13px] text-ink">list</code>{" "}
        means the page exposes no tools. Say so instead of guessing. Verify
        every result against live page state before anything consequential.
      </p>
    </article>
  );
}
