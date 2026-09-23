import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Quick start · agent-webmcp docs",
  description: "Five commands to your first verified tool call.",
};

export default function QuickStartPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Quick start
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Every task follows one loop:{" "}
        <code className="font-mono text-[13px] text-ink">
          open → list → invoke → verify → close
        </code>
        . Learn it once on a demo page and every site after behaves the same.
        Keep one <code className="font-mono text-[13px] text-ink">--session</code>{" "}
        per task and pass{" "}
        <code className="font-mono text-[13px] text-ink">--json</code> when a
        program consumes the output.
      </p>
      <CodeBlock
        code={`agent-webmcp open https://webmcp.com --session setup-check
agent-webmcp list --session setup-check
# expect: about, surprise_me, share_on_x, ...
agent-webmcp invoke surprise_me --params '{}' --json --session setup-check
agent-webmcp close --session setup-check`}
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Two habits from here on. Never invoke a tool you have not listed; the
        list is the contract. And an empty list is an answer, not an error: the
        page exposes nothing, so say so instead of guessing. Confirm each
        result against live page state before anything consequential.
      </p>
    </article>
  );
}
