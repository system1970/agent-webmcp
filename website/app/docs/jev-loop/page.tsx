import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Jev loop · agent-webmcp docs",
  description: "How the judge/doer split works: snapshot, fan-out decision, guarded act, receipt.",
};

export default function JevLoopPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Jev loop
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        One question per step: <em>of these observed elements, which
        advances the goal?</em> This is a typed Choice over a
        code-enumerated action space. The model returns an index into a table
        the harness built: never selectors, coordinates, or JavaScript.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">The cycle</h2>
      <ol className="mt-3 max-w-[62ch] list-decimal space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <strong className="text-ink">Snapshot.</strong> Actions, guards, and
          values stay in the snapshot for execution; Jev state carries labels,
          roles, and a <code className="font-mono text-[13px] text-ink">filled</code>{" "}
          presence-bit only, never values. Password, file, and hidden fields
          are excluded at capture.
        </li>
        <li>
          <strong className="text-ink">Decide.</strong> One fan-out: operation
          head, one target head per offered op, and an independent{" "}
          <code className="font-mono text-[13px] text-ink">goal_complete</code>{" "}
          judgment. Unoffered picks are rejected, never substituted.
        </li>
        <li>
          <strong className="text-ink">Act.</strong> Freshness re-check, then
          hit-tested input. Stale pages re-decide; saved decisions execute at
          most once.
        </li>
        <li>
          <strong className="text-ink">Receipt.</strong>{" "}
          <code className="font-mono text-[13px] text-ink">
            {"{operation, target, executed, page_changed, confidence}"}
          </code>
          . Terminal claims need either head at 0.7; three no-change steps
          stop the run as stuck.
        </li>
      </ol>
      <h2 className="mt-8 text-xl font-medium text-ink">Text has its own lane</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Jev never emits free text. Open strings come from the calling agent
        via flags, or from a small text model under strict contract. Missing
        text hands back{" "}
        <code className="font-mono text-[13px] text-ink">text_needed</code>{" "}
        instead of guessing.
      </p>
      <CodeBlock code={`export TYPESAFE_API_KEY="..."   # BYOK: never bundled, never logged\nagent-webmcp run --goal "Open the revenue board" --session work --max-steps 8 --json`} />
    </article>
  );
}
