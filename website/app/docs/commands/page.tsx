import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Commands · agent-webmcp docs",
  description: "Every verb: browser remote, tool cabinet, and the Jev loop.",
};

const FREE = `open [url] [--session NAME] [--headed] [--chrome PATH] [--profile NAME] [--json]
crawl <url> [--session NAME] [--json]
list [--session NAME] [--json]
invoke <tool> [--params JSON|@file] [--frame ID] [--session NAME] [--json]
eval <js|@file> [--session NAME] [--json]
observe [--session NAME] [--json]
tools <add|list|load|remove|verify> [--session NAME] [--json]
close [--session NAME | --all]
sessions [--json]
status [--session NAME] [--json]
version`;

const PAID = `decide --goal ".." [--session NAME] [--json]
act [--session NAME] [--json]
tick --goal ".." [--session NAME] [--json]
run --goal ".." [--session NAME] [--max-steps N] [--json]
auth <probe|handoff> [--session NAME] [--json]`;

export default function CommandsPage() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Commands
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Three jobs: a browser remote (eyes and hands), a tool cabinet (the
        verbs), and the loop (judgment in motion). Everything else composes
        these.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Free: $0, no keys
      </h2>
      <CodeBlock code={FREE} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">open</code> binds a
          session to a tab in the shared-profile browser and auto-injects
          verified tools for the host.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">crawl</code> is one
          call for open + inventory + tool list + link/form harvest + auth
          probe.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">list</code> tags
          provenance: native, <code className="font-mono text-[13px] text-ink">[custom]</code>,{" "}
          <code className="font-mono text-[13px] text-ink">[loop]</code>.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">close --all</code>{" "}
          kills profile browsers; profiles (logins) persist.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Ultrafast: needs TYPESAFE_API_KEY
      </h2>
      <CodeBlock code={PAID} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">decide</code> picks
          one step and never acts. <code className="font-mono text-[13px] text-ink">act</code>{" "}
          executes the saved decision once, freshness-checked.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">tick</code> fuses
          observe + decide + act.{" "}
          <code className="font-mono text-[13px] text-ink">run</code> loops to
          DONE/BLOCKED with a step budget and stuck detection.
        </li>
        <li>
          Exits: <code className="font-mono text-[13px] text-ink">0</code>{" "}
          DONE, <code className="font-mono text-[13px] text-ink">1</code>{" "}
          blocked/failed, <code className="font-mono text-[13px] text-ink">2</code>{" "}
          login wall (one-time human handoff, then re-run).
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">auth probe</code> is
          read-only gate sensing;{" "}
          <code className="font-mono text-[13px] text-ink">auth handoff</code>{" "}
          relaunches headed and waits for a human login. The human types; the
          secret never enters model context.
        </li>
      </ul>
    </article>
  );
}
