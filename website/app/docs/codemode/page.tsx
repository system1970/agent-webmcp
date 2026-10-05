import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Codemode · agent-webmcp docs",
  description: "One JS program, N tool calls, one envelope.",
};

const PROGRAM = `const found = JSON.parse(webmcp.search("catalog shoes"));
const one = found.results[0].tool;
const out = batch([{tool: one, args: {query: "red"}}]);
return {results: out};`;

export default function CodemodePage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Codemode
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Composition lives in one program, not N round trips. The agent ships
        code; QuickJS runs it against the session&apos;s tool catalog; one
        envelope comes back.
      </p>
      <CodeBlock code={PROGRAM} lang="javascript" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">tools.*</code> are
          the only externals: live page tools plus verified customs. No
          fetch, no fs, no timers, no imports.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">webmcp.search/describe</code> pulls
          definitions progressively — never assume the catalog.{" "}
          <code className="font-mono text-[13px] text-ink">batch()</code> fans
          out sequentially, ordered, capped at 8.
        </li>
        <li>
          Explicit top-level <code className="font-mono text-[13px] text-ink">return</code> is
          required. Budgets: <code className="font-mono text-[13px] text-ink">--max-calls</code> (default
          10, clamp 1..50) plus a wall timeout; every leaf call claims
          budget and checks the deadline.
        </li>
        <li>
          Errors prefixed{" "}
          <code className="font-mono text-[13px] text-ink">tool_error:</code> are
          catchable in-program; anything else aborts the run. Sites disagree
          about timing — poll with bounded retries inside budget instead of
          assuming read-after-write.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Run it
      </h2>
      <CodeBlock
        code={`agent-webmcp execute --session demo --program @shop.js
agent-webmcp search "catalog shoes" --session demo --limit 5`}
        lang="bash"
      />
    </article>
  );
}
