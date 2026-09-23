import { CodeBlock } from "../code-block";

export const metadata = {
  title: "Commands · agent-webmcp docs",
  description: "The full verb list: free tier, Jev loop, and auth.",
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
        The CLI does three jobs and each verb below serves exactly one: a
        browser remote for eyes and hands, a tool cabinet for the verbs
        themselves, and the loop for judgment in motion. Compositions like{" "}
        <code className="font-mono text-[13px] text-ink">crawl</code> just run
        several of these in one call.
      </p>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Free: $0, no keys
      </h2>
      <CodeBlock code={FREE} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">open</code> binds a
          session to a tab in the shared-profile browser, then auto-injects
          verified tools for that host.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">crawl</code> folds
          open, inventory, tool list, link harvest, and auth probe into one
          envelope for indexing work.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">list</code> tags
          each tool with its provenance: native,{" "}
          <code className="font-mono text-[13px] text-ink">[custom]</code>, or{" "}
          <code className="font-mono text-[13px] text-ink">[loop]</code>. Ours
          never masquerade as the site&apos;s.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">close --all</code>{" "}
          kills profile browsers. Profiles, and the logins inside them,
          survive.
        </li>
      </ul>
      <h2 className="mt-8 text-xl font-medium text-ink">
        Ultrafast: needs TYPESAFE_API_KEY
      </h2>
      <CodeBlock code={PAID} lang="text" />
      <ul className="mt-3 max-w-[62ch] list-disc space-y-1 pl-5 text-[15px] leading-7 text-ink-2">
        <li>
          <code className="font-mono text-[13px] text-ink">decide</code> picks
          one step and stops.{" "}
          <code className="font-mono text-[13px] text-ink">act</code> executes
          that saved decision exactly once, after re-checking the page is
          unchanged.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">tick</code> fuses
          observe, decide, and act into a single step.{" "}
          <code className="font-mono text-[13px] text-ink">run</code> repeats
          ticks to DONE or BLOCKED inside a step budget, stopping early on
          three stagnant steps.
        </li>
        <li>
          Exits read as contracts:{" "}
          <code className="font-mono text-[13px] text-ink">0</code> done,{" "}
          <code className="font-mono text-[13px] text-ink">1</code>{" "}
          blocked or failed,{" "}
          <code className="font-mono text-[13px] text-ink">2</code> login wall.
          The wall is a pause with a remedy, not a failure.
        </li>
        <li>
          <code className="font-mono text-[13px] text-ink">auth probe</code>{" "}
          senses the gate without touching it.{" "}
          <code className="font-mono text-[13px] text-ink">auth handoff</code>{" "}
          opens a headed window where you type the password yourself; the
          secret never enters model context, logs, or tool state.
        </li>
      </ul>
    </article>
  );
}
