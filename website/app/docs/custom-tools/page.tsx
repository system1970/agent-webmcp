import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Custom tools · agent-webmcp docs",
  description: "Craft the page's missing tools, verify them, compose them.",
};

export default function CustomToolsPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Custom tools
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        When the page lacks tools the task needs, craft them: page
        JavaScript that registers through the page&apos;s own{" "}
        <code className="font-mono text-[13px] text-ink">document.modelContext</code>,
        exactly like a site-native tool. Crafted tools are indistinguishable
        from found ones at invoke time.
      </p>
      <CodeBlock
        code={`agent-webmcp-rs tools add --file heading.js --for example.com --name page_heading
agent-webmcp-rs tools verify page_heading --session demo
agent-webmcp-rs tools list --query heading`}
        lang="bash"
      />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          Tools are host-scoped (<code className="font-mono text-[13px] text-ink">--for</code> takes
          exact hosts, <code className="font-mono text-[13px] text-ink">*.suffix</code>, or{" "}
          <code className="font-mono text-[13px] text-ink">*</code>) and live
          under <code className="font-mono text-[13px] text-ink">~/.agent-webmcp/tools/</code>.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">verify</code>{" "}
          reloads, injects, and confirms every registered name in{" "}
          <code className="font-mono text-[13px] text-ink">list</code>. Only
          verified tools auto-inject on{" "}
          <code className="font-mono text-[13px] text-ink">open</code> —
          unverified tools never run unannounced.
        </li>
        <li>
          The craft loop is discover → craft → verify → compose → expose:
          page tools and crafted tools become one toolkit over MCP and CLI
          alike.
        </li>
      </ul>
    </article>
  );
}
