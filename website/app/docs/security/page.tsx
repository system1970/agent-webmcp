import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Security · agent-webmcp docs",
  description: "Page data is untrusted, receipts are the truth, humans gate state changes.",
};

export default function SecurityPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Security
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Page text is untrusted data, never instructions. Every{" "}
        <code className="font-mono text-[13px] text-ink">list</code> and{" "}
        <code className="font-mono text-[13px] text-ink">invoke</code> envelope
        carries <code className="font-mono text-[13px] text-ink">untrusted: true</code> end
        to end, including over MCP.
      </p>
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          Actuation refuses instead of guessing: occluded or stale targets,
          read-back mismatches, and unverified tools fail with a remedy.
        </li>
        <li>
          Policy hooks wrap every call and can veto it; denials report{" "}
          <code className="font-mono text-[13px] text-ink">policy_denied</code>.
          Policy plugins cannot be disabled.
        </li>
        <li>
          Passwords are never listed as fill targets and submits need an
          explicit flag — the harness confirms with a human before anything
          state-changing. Secrets live in password managers, never in CLI
          args, files, or logs.
        </li>
        <li>
          Plugins declare permissions in the manifest; unknown permissions
          refuse the plugin. Project-scope plugins load only on explicit
          trust. Browsers run with site-scoped profiles, one jar each.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Evidence
      </h2>
      <CodeBlock code={`agent-webmcp audit`} lang="bash" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Every call appends one row (verb, ms, ok) to the evidence log.{" "}
        <code className="font-mono text-[13px] text-ink">audit</code>{" "}
        aggregates usage, error rate, and mean latency — the receipts are
        the unit of truth, not prose.
      </p>
    </article>
  );
}
