import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Codemode · agent-webmcp docs",
  description: "Search the tool catalog, write one program, get one envelope back.",
};

export default function CodemodePage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Codemode
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Calling tools one at a time costs a round trip per call. Codemode
        inverts that: the agent writes one JavaScript program against the
        session&apos;s tools, the CLI runs it in-process, and a single
        envelope comes back. Search first, compose second, return only what
        the answer needs.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">1. Search the catalog</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The catalog is partial by design. Query it with plain words and copy
        the returned path and schema verbatim. Never guess a tool name.
      </p>
      <CodeBlock
        code={`agent-webmcp list --session work --query "page text" --json
# → [{path: "tools.dummy_page_title", description, kind, required, schema}]`}
      />
      <h2 className="mt-8 text-xl font-medium text-ink">2. Write one program</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Call tools by exact path with one object argument. Dependent calls
        read earlier results; independent calls fan out through{" "}
        <code className="font-mono text-[13px] text-ink">batch()</code>, which
        runs capped at 8 concurrent and returns ordered results. End with an
        explicit <code className="font-mono text-[13px] text-ink">return</code>{" "}
        holding only the fields the answer needs.
      </p>
      <CodeBlock
        code={`// prog.js: dependent calls, one envelope out
const hits = tools.tinystartups_search({query: "AI"});
const slug = hits[0].url.split("/startup/")[1];
const detail = tools.tinystartups_view_startup({id: slug});
return {found: hits.length, title: hits[0].title, about: detail.description};

// fan-out reads instead:
const parts = batch([
  {tool: "dummy_page_title", args: {}},
  {tool: "dummy_page_links", args: {}},
]);
return {title: parts[0], links: parts[1]};`}
      />
      <h2 className="mt-8 text-xl font-medium text-ink">3. Execute it</h2>
      <CodeBlock
        code={`agent-webmcp execute --program @prog.js --session work --json
# → {"result": {...}, "tool_calls": 2}`}
      />
      <h2 className="mt-8 text-xl font-medium text-ink">Rules</h2>
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">tools.*</code> are
          the only externals. No fetch, no filesystem, no timers, no imports.
          Programs spend authority the tools already hold; they gain none.
        </li>
        <li>
          Budgets are flags:{" "}
          <code className="font-mono text-[13px] text-ink">--max-calls</code>{" "}
          (default 10, cap 50),{" "}
          <code className="font-mono text-[13px] text-ink">--timeout-ms</code>{" "}
          interrupts the run.
        </li>
        <li>
          Confirm-gated loop tools refuse inside programs; invoke them
          directly. A login wall aborts the program as a typed pause with a
          remedy, like every other verb.
        </li>
        <li>
          Unknown names fail with the available tool list attached. Read it,
          fix the program, re-run.
        </li>
      </ul>
    </article>
  );
}
