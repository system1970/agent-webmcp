import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Configuration · agent-webmcp docs",
  description: "Environment: plugin control, sessions, profiles, trust.",
};

export default function ConfigurationPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Configuration
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Everything is environment. No config files, no keys, no vault —
        secrets live in password managers, never in the CLI.
      </p>
      <CodeBlock
        code={`AGENT_WEBMCP_PLUGINS="*,-browser.act"   # control: *, -id, -ns.*
AGENT_WEBMCP_SESSION="work"              # default session
AGENT_WEBMCP_PROFILE="shared"            # default cookie jar
AGENT_WEBMCP_TRUST_PROJECT=1             # load <wd>/.agent-webmcp/plugins/
AGENT_WEBMCP_PLUGINS_DIR="./extra"       # extra plugin scope dirs`}
        lang="bash"
      />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          Control lists evaluate in order; a later id re-enables.{" "}
          <code className="font-mono text-[13px] text-ink">core.policy</code> and{" "}
          <code className="font-mono text-[13px] text-ink">core.receipts</code> ignore
          removals.
        </li>
        <li>
          One profile is one browser and one cookie jar. Sessions bind to
          their own tabs and reattach across invocations. State lives under{" "}
          <code className="font-mono text-[13px] text-ink">~/.agent-webmcp/rust/</code>.
        </li>
        <li>
          Crafted tools live under{" "}
          <code className="font-mono text-[13px] text-ink">~/.agent-webmcp/tools/</code>;
          user plugins under{" "}
          <code className="font-mono text-[13px] text-ink">~/.agent-webmcp/plugins/</code>.
        </li>
      </ul>
    </article>
  );
}
