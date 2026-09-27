import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Security · agent-webmcp docs",
  description: "Threat model: untrusted pages, redaction rules, keys, vault.",
};

export default function SecurityPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Security
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        The threat is the page. Every site you open is untrusted input with
        goals of its own: prompt injection in tool descriptions, fake consent
        claims, lying schemas. The CLI assumes hostility and says what it
        does about it below. What is opt-in versus default is stated, not
        implied.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Page text is data</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Tool descriptions, schemas, answers, and page text never become
        instructions. Machine envelopes that carry page-derived content say
        so: <code className="font-mono text-[13px] text-ink">list</code>,{" "}
        <code className="font-mono text-[13px] text-ink">observe</code>,{" "}
        <code className="font-mono text-[13px] text-ink">search</code> (with a
        live session), and every <code className="font-mono text-[13px] text-ink">invoke</code>{" "}
        result arrive with{" "}
        <code className="font-mono text-[13px] text-ink">untrusted: true</code>.
        The judge sees labels and roles; values stay local. Confirm money,
        commitment, and identity calls against your own request
        first — a site agent&apos;s reply is input, not permission.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Redaction (default)</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Password, file, and hidden fields never enter snapshots or model
        state. Other field values stay in guards for acting; Jev sees a{" "}
        <code className="font-mono text-[13px] text-ink">filled</code> bit,
        never the content. Geometry resolves just before input, so layout
        shifts can&apos;t redirect a guarded click.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Keys (your env)</h2>
      <CodeBlock
        code={`export TYPESAFE_API_KEY="..."   # ultrafast tier, BYOK
export AGENT_WEBMCP_VAULT_KEY="..." # optional: 64 hex chars, else a machine-local key file`}
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Keys live in your environment, never in repos, files, or chat. The
        CLI never bundles, logs, or persists them. A missing key refuses the
        ultrafast verbs (<code className="font-mono text-[13px] text-ink">no_key</code>)
        instead of degrading silently.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Vault (opt-in)</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Saved logins are AES-256-GCM sealed, machine-local, profile names
        bound as associated data. The fill path decrypts in-process and
        records <code className="font-mono text-[13px] text-ink">[vault]</code>{" "}
        instead of text — receipts, history, and logs carry metadata only.
        The model never sees a password; prefer{" "}
        <code className="font-mono text-[13px] text-ink">--password-stdin</code>{" "}
        over flags.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">Bounds, not trust</h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Terminal claims need 0.7 on either head or the run records an honest
        stop. Saved decisions execute once, then burn. Loop tools certify
        outcomes in code (<code className="font-mono text-[13px] text-ink">expect</code>),
        never on the judge&apos;s word. Session evidence (decisions,
        snapshots, caches) holds field values and is owner-only on disk —
        directories 0700, files 0600.
      </p>
    </article>
  );
}
