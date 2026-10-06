import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Plugins · agent-webmcp docs",
  description: "Manifest plugins: scopes, sandbox, control, authoring.",
};

const MANIFEST = `{
  "id": "acme.compare",
  "version": "1.2.0",
  "engine": "^0.1.0",
  "permissions": ["network"],
  "contributes": {
    "verbs": [{"name": "compare", "help": "one line for a model reader", "run": "./main.js"}],
    "tools": ["./tools/*.js"],
    "skills": ["./SKILL.md"]
  }
}`;

const DIRS = `./plugins/*/                 scope repo, dev
~/.agent-webmcp/plugins/*/       scope user, always loaded
<wd>/.agent-webmcp/plugins/*/     scope project, trusted only`;

export default function PluginsPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Plugins
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        A plugin is a directory with a{" "}
        <code className="font-mono text-[13px] text-ink">plugin.json</code>.
        Verbs run as sandboxed JS with an{" "}
        <code className="font-mono text-[13px] text-ink">args</code> global
        plus the session page-tool catalog — the same sandbox as codemode.
        No fetch, no fs.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Manifest
      </h2>
      <CodeBlock code={MANIFEST} lang="json" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">id</code> chars:{" "}
          <code className="font-mono text-[13px] text-ink">a-z 0-9 . - _</code>.{" "}
          <code className="font-mono text-[13px] text-ink">core.*</code> is
          reserved. <code className="font-mono text-[13px] text-ink">engine</code> must
          match the binary. <code className="font-mono text-[13px] text-ink">run</code> stays
          inside the plugin dir.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">permissions</code>:{" "}
          <code className="font-mono text-[13px] text-ink">browser network secrets fs spawn</code>.
          Unknown refuses the plugin. Verb <code className="font-mono text-[13px] text-ink">flags</code> declares
          value flags so values never leak into positionals.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Scopes
      </h2>
      <CodeBlock code={DIRS} lang="text" />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Project scope loads only with{" "}
        <code className="font-mono text-[13px] text-ink">AGENT_WEBMCP_TRUST_PROJECT=1</code>.
        First plugin id wins; built-in verbs always win collisions. A broken
        manifest warns on stderr and is skipped — boot never fails on
        plugins. Plugin tools are listed, never auto-installed.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Authoring
      </h2>
      <CodeBlock
        code={`agent-webmcp plugin new acme.compare    # user scope
agent-webmcp plugin new acme.compare --here  # repo dev
agent-webmcp plugin add ./acme-compare --here
agent-webmcp plugin show acme.compare
agent-webmcp plugin remove acme.compare`}
        lang="bash"
      />
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Disable with{" "}
        <code className="font-mono text-[13px] text-ink">AGENT_WEBMCP_PLUGINS=-acme.*</code> (namespace)
        or <code className="font-mono text-[13px] text-ink">-acme.compare</code> (id).
        Only <code className="font-mono text-[13px] text-ink">core.policy</code> and{" "}
        <code className="font-mono text-[13px] text-ink">core.receipts</code> ignore
        removals. The repo ships <code className="font-mono text-[13px] text-ink">hello-echo</code> as
        a copy-pasteable example.
      </p>
    </article>
  );
}
