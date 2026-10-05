import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Quick start · agent-webmcp docs",
  description: "Open a page, snapshot it, call its tools, compose a program.",
};

export default function QuickStartPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Quick start
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The loop: open, observe, list, invoke, compose. Five calls, each
        copy-pasteable.
      </p>
      <CodeBlock
        code={`agent-webmcp open https://webmcp.com --session demo
agent-webmcp observe --session demo
agent-webmcp list --session demo
agent-webmcp search hatch --session demo
agent-webmcp execute --session demo --program '
  const found = JSON.parse(webmcp.search("hatch"));
  const out = batch([{tool: found.results[0].tool, args: {}}]);
  return {hatched: out};'`}
        lang="bash"
      />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">open</code> binds
          the session to its own tab and reports port, reuse, and headedness.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">observe</code>{" "}
          returns snapshot refs (<code className="font-mono text-[13px] text-ink">@eN</code>) for
          clicking and filling;{" "}
          <code className="font-mono text-[13px] text-ink">list</code> returns
          the tools the page itself speaks.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">execute</code>{" "}
          runs one program over many tools with budgets and returns one
          envelope. Re-observe after every navigation — refs never survive
          one.
        </li>
      </ul>
    </article>
  );
}
