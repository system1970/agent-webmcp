import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Custom tools · agent-webmcp docs",
  description: "Author verified tools per site: page JS for stable DOM, loop goals for flows needing judgment.",
};

export default function CustomToolsPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Custom tools
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Two kinds. <strong className="text-ink">Page tools</strong> are
        JavaScript evaluated in the page that registers via{" "}
        <code className="font-mono text-[13px] text-ink">
          document.modelContext
        </code>{" "}
        : deterministic, for stable DOM.{" "}
        <strong className="text-ink">Loop tools</strong> carry a goal template
        executed as a bounded Jev run: for wizards, conditional flows, and
        dynamic widgets that page JS cannot judge. Page JS can never reach
        the loop, so the split is structural, not stylistic.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Author a page tool</h2>
      <CodeBlock
        code={`# 1. Write JS that feature-detects modelContext, calls
#    registerTool({name, description, inputSchema, execute}),
#    guards re-registration, and prints 'ok:<name>'.
# 2. Register it for a host:
agent-webmcp tools add ./search.js --for example.com --name example_search
# 3. Verify against the live page:
agent-webmcp tools verify example_search --session work
# 4. Use it (auto-injects on every open of the host):
agent-webmcp invoke example_search --params '{"query":"AI"}' --session work`}
      />
      <h2 className="mt-8 text-xl font-medium text-ink">Author a loop tool</h2>
      <CodeBlock
        code={`agent-webmcp tools add \\
  --goal "Fill the signup field with {{email}} and press Continue. Stop when a welcome message is visible." \\
  --for example.com --name example_signup \\
  --fields "email" --fill email --max-steps 8 --confirm \\
  --expect "Welcome" --expect-url example.com/welcome`}
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Write goals in observable terms (“a form with Name and email fields
        is visible”), never ordinals (“step 2”). The judge certifies what it
        can see. <code className="font-mono text-[13px] text-ink">expect</code>{" "}
        markers are asserted in code after the run: the judge navigates,
        code certifies. Unverified tools never auto-inject.
      </p>
    </article>
  );
}
