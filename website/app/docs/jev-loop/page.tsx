import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Jev loop · agent-webmcp docs",
  description: "Why the loop splits judging from doing, and how each step runs.",
};

export default function JevLoopPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Jev loop
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Acting on a page means answering one question over and over: of these
        observed elements, which moves the goal forward. That question has a
        fixed set of answers, so it goes to a classifier, not a prose writer.
        Jev picks an operation and a target in one fan-out; deterministic code
        owns everything around that choice. The model returns an index into a
        table the harness built. It never emits selectors, coordinates, or
        JavaScript, which bounds every wrong answer to one guarded step.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">The cycle</h2>
      <ol className="mt-3 max-w-[62ch] list-decimal space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <strong className="text-ink">Snapshot.</strong> Actions, guards, and
          values stay in the snapshot because execution needs them. What Jev
          sees is smaller: labels, roles, and a{" "}
          <code className="font-mono text-[13px] text-ink">filled</code> bit
          that says a field holds text without saying which. Password, file,
          and hidden fields never enter at all.
        </li>
        <li>
          <strong className="text-ink">Decide.</strong> One request carries the
          operation head, one target head per offered operation, and a
          separate completion judgment. Code consumes only the head matching
          the chosen operation and rejects anything unoffered outright.
        </li>
        <li>
          <strong className="text-ink">Act.</strong> The page gets re-checked
          for changes first; a shifted page re-decides instead of clicking
          blind. Saved decisions run once, then burn.
        </li>
        <li>
          <strong className="text-ink">Receipt.</strong> Each step returns
          operation, target, whether the page changed, and confidence.
          Terminal claims need real conviction (0.7 on either head) or the
          run records an honest stop instead of a fake success.
        </li>
      </ol>
      <h2 className="mt-8 text-xl font-medium text-ink">Text has its own lane</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Jev cannot invent strings, so it never tries. Fill text arrives from
        the calling agent&apos;s flags or a small text model under strict
        contract; a missing value returns{" "}
        <code className="font-mono text-[13px] text-ink">text_needed</code>{" "}
        instead of a guess.
      </p>
      <CodeBlock code={`export TYPESAFE_API_KEY="..."   # BYOK: never bundled, never logged\nagent-webmcp run --goal "Open the revenue board" --session work --max-steps 8 --json`} />
    </article>
  );
}
