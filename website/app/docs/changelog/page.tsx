export const metadata = {
  title: "Changelog · agent-webmcp docs",
  description: "What changed, newest first.",
};

export default function ChangelogPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Changelog
      </h1>
      <h2 className="mt-8 text-xl font-medium text-ink">
        0.1.0 — Rust bridge
      </h2>
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>Verbs-as-plugins registry with opencode-style control.</li>
        <li>Trusted click/fill with hit-test and read-back verification.</li>
        <li>Detached invoke outlives the CLI via a forked daemon.</li>
        <li>Manifest plugins: repo/user/project scopes, sandboxed JS verbs.</li>
        <li>Honest error codes with an exit split (2 dispatch, 1 call).</li>
        <li>Evidence log plus audit; build rev stamps; safe installer.</li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        0.4.0 — Go CLI (archived)
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The original Go CLI, removed 2026-10-05 and superseded by the Rust
        port. Its design survives: origin checks, field binding, receipts,
        the quiet-250ms/cap-900ms WebMCP drain, secrets-as-plugins. The
        vault, judgment loop, and auth verbs did not carry over — parked by
        decision, not by accident.
      </p>
    </article>
  );
}
