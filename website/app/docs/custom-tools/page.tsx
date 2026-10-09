import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Custom tools · agent-webmcp docs",
  description: "Author page tools agents can call: registerTool recipe, annotations, return shapes.",
};

export default function CustomToolsPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Custom tools
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        When the page lacks tools the task needs, author them: page
        JavaScript that registers through the page&apos;s own{" "}
        <code className="font-mono text-[13px] text-ink">document.modelContext</code>.
        The engine reads them like site-native tools — open, list, invoke,
        close, no special path.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Recipe</h2>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Save this as <code className="font-mono text-[13px] text-ink">shop.html</code> and
        serve its directory (<code className="font-mono text-[13px] text-ink">python3 -m http.server 8901</code>) —
        every line below runs against it.
      </p>
      <CodeBlock
        code={`<h1>Demo shop</h1>
<script>
const STOCK = { "widget": 42, "gadget": 7 };
document.modelContext.registerTool({
  name: "getStock",
  description: "Look up on-hand stock for a SKU.",
  inputSchema: {
    type: "object",
    properties: { sku: { type: "string" } },
    required: ["sku"]
  },
  annotations: { readOnlyHint: true },
  execute: async (args) => ({ sku: args.sku, onHand: STOCK[args.sku] ?? 0 })
});
</script>`}
        lang="html"
      />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">name</code> is
          the verb; <code className="font-mono text-[13px] text-ink">description</code> ranks
          in search — write it for the agent, not the user.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">inputSchema</code> is
          a JSON Schema object (not a string). Required args first.
        </li>
        <li>
          Return JSON-shaped data (objects, arrays), never display strings:
          the engine normalizes outputs to one shape, and code that joins
          tools consumes values directly — a string forces every caller to
          parse it back out.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">Annotations</h2>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The engine reasons over three flags. Spec-style{" "}
        <code className="font-mono text-[13px] text-ink">Hint</code> spellings
        map to them (base spelling wins on conflict); anything else —
        including <code className="font-mono text-[13px] text-ink">consequentialHint</code> — is
        dropped, not enforced. Hints inform confirmation UX; they enforce nothing.
      </p>
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">readOnlyHint → readOnly</code>:
          safe to call without asking (lookups, searches).
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">untrustedContentHint → untrustedContent</code>:
          output carries page data worth quarantining.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">autosubmit</code>:
          passes through as-is.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">Verify</h2>
      <CodeBlock
        code={`agent-webmcp open --json http://localhost:8901/shop.html
agent-webmcp list <handle> --json   # annotations + schemas, as the agent sees them
agent-webmcp invoke <handle> getStock '{"sku":"widget"}'`}
        lang="bash"
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        If <code className="font-mono text-[13px] text-ink">toolCount</code> is 0
        at open, list again before concluding empty — pages register tools as
        they load. Then compose: one <code className="font-mono text-[13px] text-ink">execute</code> block
        joins tools across sessions in a single turn.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Internal tabs</h2>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The desktop app&apos;s built-in browser exposes no WebMCP surface
        (no flags at launch) and no automation channel — the engine cannot
        attach to its tabs. Drive them from the harness instead: open a
        tab, install a small <code className="font-mono text-[13px] text-ink">modelContext</code> polyfill
        with <code className="font-mono text-[13px] text-ink">evaluate</code>, then
        list and invoke through it. The tab ID is the session handle;
        close what you open.
      </p>
      <CodeBlock
        code={`// once per tab (idempotent): open, then evaluate this
(() => {
  if (document.modelContext && document.modelContext.__awm) return "present";
  const tools = new Map();
  document.modelContext = {
    __awm: true,
    registerTool: (t) => { tools.set(t.name, t); return true; },
    getTools: async () => [...tools.values()].map((t) => ({
      name: t.name, description: t.description ?? "",
      inputSchema: t.inputSchema ?? {}, annotations: t.annotations ?? {} })),
    executeTool: async (name, args) => {
      const t = tools.get(name);
      if (!t) throw new Error("unknown tool '" + name + "'");
      return await t.execute(args ?? {});
    }
  };
  return "installed";
})()
// list:   (async () => await document.modelContext.getTools())()
// invoke: (async () => await document.modelContext.executeTool("getStock", { sku: "widget" }))()
// (wrap in async IIFE — top-level await is rejected)`}
        lang="js"
      />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          Register tools after the polyfill with the same recipe above —
          they resolve through <code className="font-mono text-[13px] text-ink">getTools</code>/
          <code className="font-mono text-[13px] text-ink">executeTool</code> identically.
        </li>
        <li>
          Values arrive JSON-serializable only; unknown tools fail with{" "}
          <code className="font-mono text-[13px] text-ink">unknown tool &apos;name&apos;</code> —
          fail loud, same as sessions.
        </li>
        <li>
          Chain tabs like sessions: one block, one invoke per tab, join in
          code. Verified live across two tabs, zero remaining after close.
        </li>
      </ul>
      <h3 className="mt-6 text-lg font-medium text-ink">Multi-tab joins</h3>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        One block, N tabs: open all, install the polyfill everywhere, fan
        out invokes with <code className="font-mono text-[13px] text-ink">Promise.all</code>,
        join the values, close all in <code className="font-mono text-[13px] text-ink">finally</code> and
        verify empty. Serialize args with{" "}
        <code className="font-mono text-[13px] text-ink">JSON.stringify</code> into
        the script (100k cap — chunk large args); wrap invokes so a miss
        resolves to data, never an abort.
      </p>
      <CodeBlock
        code={`const POLY = \`...polyfill above...\`;
const CALL = (tool, args) =>
  \`(async () => await document.modelContext.executeTool("\${tool}", \${JSON.stringify(args)}))()\`;
const tabs = [];
try {
  for (const url of URLS) {
    const t = await tools.browser.tabs.open({ url });
    tabs.push({ ...t, gen: t.generation });
    await tools.browser.evaluate({ tabID: t.id, script: POLY });
  }
  const out = await Promise.all(tabs.map((t, i) =>
    tools.browser.evaluate({ tabID: t.id, script: CALL(TOOL[i], ARGS[i]) })
      .then((r) => ({ ok: true, value: r.value }),
            (e) => ({ ok: false, error: String(e?.message ?? e).slice(0, 200) }))));
  return join(out);
} finally {
  for (const t of tabs) { try { await tools.browser.tabs.close({ tabID: t.id }); } catch {}
  }
  const rest = await tools.browser.tabs.list();
  if (rest.tabs.length > 0) throw new Error("stray tabs: " + rest.tabs.map((t) => t.id).join(","));
}`}
        lang="js"
      />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          Navigation wipes the registry (verified: generation 2 → 3,
          registry lost). Guard with the generation counter: on change,
          re-install the polyfill and re-register before invoking.
        </li>
        <li>
          Close discipline holds even on abort — a failed run&apos;s{" "}
          <code className="font-mono text-[13px] text-ink">finally</code> still
          reaped its tabs (verified: zero leaked).
        </li>
      </ul>
    </article>
  );
}
