import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Commands · agent-webmcp docs",
  description: "Every verb the Rust CLI serves: browse, act, WebMCP, craft, compose, system.",
};

const BROWSE = `open <url> [--session NAME] [--profile NAME] [--headed]
observe [--session NAME]
eval <js> [--session NAME]
close [--session NAME] [--all]
sessions`;

const ACT = `click <@eN> [--session NAME]
fill <@eN> <text> [--session NAME] [--submit]`;

const WEBMCP = `list [--session NAME]
invoke <tool> [--params JSON] [--frame ID] [--tool NAME] [--detach]
result <invocation> [--session NAME]`;

const COMPOSE = `tools <add|list|verify>
search <terms> [--session NAME] [--limit N] [--offset N]
execute --program @file|<js> [--session NAME] [--max-calls N]`;

const SYSTEM = `plugin <list|new|show|add|remove>
audit
version
mcp`;

export default function CommandsPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Commands
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Every verb is a plugin and every call returns JSON — pretty on a
        TTY, compact when piped. Flags may precede or follow positionals.
        Page-derived data always carries{" "}
        <code className="font-mono text-[13px] text-ink">untrusted: true</code>.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Browse
      </h2>
      <CodeBlock code={BROWSE} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">open</code>{" "}
          reuses the profile&apos;s browser (one profile, one cookie jar),
          binds the session to its own tab, navigates, and auto-injects
          verified custom tools for the host. A headed/headless mismatch
          relaunches instead of lying.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">observe</code>{" "}
          returns stable snapshot refs (<code className="font-mono text-[13px] text-ink">@eN</code>)
          with kinds click/fill/select/scroll. Refs die on navigation:
          re-observe after every act. Password, file, hidden, and disabled
          controls are never listed.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">close --all</code>{" "}
          kills profile browsers. Profiles, and the logins inside them,
          survive.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Act
      </h2>
      <CodeBlock code={ACT} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">click</code> is
          trusted CDP input on a hit-tested point: occluded, off-viewport,
          or stale targets refuse with a remedy instead of clicking blind.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">fill</code>{" "}
          focuses, types through trusted input, and reads the value back —
          a mismatch fails the call. <code className="font-mono text-[13px] text-ink">--submit</code> fills
          first; the harness confirms before anything state-changing.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        WebMCP
      </h2>
      <CodeBlock code={WEBMCP} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">list</code> shows
          the tools the page itself speaks — found, never invented.{" "}
          <code className="font-mono text-[13px] text-ink">invoke</code>{" "}
          calls one; <code className="font-mono text-[13px] text-ink">--tool NAME</code> exists
          for harness-style calls where every argument arrives as a flag.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">--detach</code>{" "}
          returns an invocation id at once while a forked daemon holds the
          connection for slow tools;{" "}
          <code className="font-mono text-[13px] text-ink">result</code>{" "}
          collects pending/ready/error. The daemon outlives the CLI.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Craft and compose
      </h2>
      <CodeBlock code={COMPOSE} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">tools add</code>{" "}
          stages page JavaScript that registers through the page&apos;s own{" "}
          <code className="font-mono text-[13px] text-ink">document.modelContext</code>, host-scoped.{" "}
          <code className="font-mono text-[13px] text-ink">tools verify</code>{" "}
          reloads, injects, and confirms every name in{" "}
          <code className="font-mono text-[13px] text-ink">list</code> — only
          verified tools auto-inject.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">search</code>{" "}
          discovers progressively (pull definitions, never the catalog);{" "}
          <code className="font-mono text-[13px] text-ink">execute</code> runs
          one JS program over many tools with budgets. See Codemode.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        System
      </h2>
      <CodeBlock code={SYSTEM} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">plugin list</code>{" "}
          shows registry state; <code className="font-mono text-[13px] text-ink">new</code> scaffolds,{" "}
          <code className="font-mono text-[13px] text-ink">show</code> inspects,{" "}
          <code className="font-mono text-[13px] text-ink">add</code> installs from
          a dir or git URL (validated before copying, live next invocation),{" "}
          <code className="font-mono text-[13px] text-ink">remove</code> uninstalls
          (built-ins refuse). <code className="font-mono text-[13px] text-ink">audit</code> aggregates
          the evidence log: usage, error rate, mean ms per verb.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">mcp</code> serves
          the same registry over stdio JSON-RPC, so CLI and harness surfaces
          cannot drift. <code className="font-mono text-[13px] text-ink">version</code> prints
          the binary version plus build rev.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Errors
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Failures are honest codes: <code className="font-mono text-[13px] text-ink">usage</code> (fix
        args), <code className="font-mono text-[13px] text-ink">not_found</code> (discover
        first), <code className="font-mono text-[13px] text-ink">stale_target</code> (re-observe),{" "}
        <code className="font-mono text-[13px] text-ink">no_browser</code> /{" "}
        <code className="font-mono text-[13px] text-ink">no_session</code> (open
        first), <code className="font-mono text-[13px] text-ink">policy_denied</code> (refused),{" "}
        <code className="font-mono text-[13px] text-ink">tool_failed</code> (diagnose).
        Exit 2 is dispatch failure (unknown verb); exit 1 is call failure.
      </p>
    </article>
  );
}
