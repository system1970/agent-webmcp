import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Troubleshooting · agent-webmcp docs",
  description: "Real errors, real fixes: key, browser, walls, and stuck runs.",
};

export default function TroubleshootingPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Troubleshooting
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Every error below is one the CLI actually emits. Match the code,
        apply the fix, move on.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">No key</h2>
      <CodeBlock code={`{"code":"no_key","error":"ultrafast needs TYPESAFE_API_KEY ..."}`} lang="json" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        <code className="font-mono text-[13px] text-ink">decide</code>,{" "}
        <code className="font-mono text-[13px] text-ink">tick</code>, and{" "}
        <code className="font-mono text-[13px] text-ink">run</code> refuse
        without a key. Export it per shell; the CLI never bundles, logs, or
        stores one. The free tier keeps working.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">No browser</h2>
      <CodeBlock code={`chrome not found: install Chrome 149+ or pass --chrome <path>`} lang="text" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Locate the binary and retry with{" "}
        <code className="font-mono text-[13px] text-ink">--chrome</code> or set{" "}
        <code className="font-mono text-[13px] text-ink">AGENT_WEBMCP_CHROME</code>.
        Zen and Firefox have no CDP; a hanging{" "}
        <code className="font-mono text-[13px] text-ink">open</code> usually
        means the wrong browser.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Login wall</h2>
      <CodeBlock code={`{"code":"auth_required","data":{"host":"...","remedy":"auth handoff --session S --url ..."}}`} lang="json" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Exit code 2, a pause rather than a failure. Run the remedy: a headed
        window opens on the login page, you type the password yourself, the
        CLI polls until the wall clears, then re-run the goal. Never paste
        credentials to the agent.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Stuck run</h2>
      <CodeBlock code={`{"code":"blocked","error":"stuck: 3 no-change steps"}`} lang="json" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Three steps changed nothing, so the run stopped instead of burning
        budget. Read the receipts, narrow the goal, re-run. A premature DONE
        refused under 0.7 confidence lands here too, as an unconfirmed stop.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Tool not found</h2>
      <CodeBlock code={`{"code":"invoke_failed","error":"tool \\"x\\" not found (run: list)"}`} lang="json" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Full navigations drop per-document registrations.{" "}
        <code className="font-mono text-[13px] text-ink">invoke</code>{" "}
        re-injects session-recorded tools silently; if it still fails,{" "}
        <code className="font-mono text-[13px] text-ink">list</code> first, or{" "}
        <code className="font-mono text-[13px] text-ink">tools load</code>{" "}
        explicitly.
      </p>
    </article>
  );
}
