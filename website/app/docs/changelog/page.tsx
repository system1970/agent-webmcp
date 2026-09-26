export const metadata = {
  title: "Changelog · agent-webmcp docs",
  description: "Dated releases. The changelog starts at v0.4.0.",
};

export default function ChangelogPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Changelog
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Dated, per release. Earlier history lives in git; the written record
        starts here.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        v0.4.0 — 2026-09-27
      </h2>
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          Vault: AES-256-GCM sealed logins (
          <code className="font-mono text-[13px] text-ink">auth save/login/list/show/delete</code>),
          in-process fill, metadata-only receipts.
        </li>
        <li>
          MCP server: stdio JSON-RPC, core profile (open, list, invoke,
          observe, close), in-process dispatch.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">doctor</code> verb:
          version, Chrome, sessions, key, registry, vault, live open.
        </li>
        <li>
          Open announces native page tools by name;{" "}
          <code className="font-mono text-[13px] text-ink">@e1</code> targets
          accepted; sessions show profile, headedness, dead bindings.
        </li>
        <li>
          Codemode: ranked <code className="font-mono text-[13px] text-ink">search</code>{" "}
          (opencode scoring port) + sandboxed{" "}
          <code className="font-mono text-[13px] text-ink">execute</code>.
        </li>
      </ul>
    </article>
  );
}
