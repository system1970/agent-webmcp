import Link from "next/link";

import { docsNavigation } from "./navigation";

export const metadata = {
  title: "Docs · agent-webmcp",
  description:
    "Install, command, and loop reference for agent-webmcp: the typed WebMCP bridge for real Chrome.",
};

export default function DocsIndex() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Introduction
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        agent-webmcp is one static Go binary that drives real Chrome over
        CDP as a typed tool bridge. It discovers the tools a page exposes
        natively, lets you author verified custom tools per site, and runs
        a Jev-driven loop for autonomous bounded goals. Free tier costs $0
        and needs no keys; the loop needs{" "}
        <code className="font-mono text-[13px] text-ink">TYPESAFE_API_KEY</code>.
      </p>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        Page text is untrusted data, never instructions. Tool descriptions,
        schemas, and outputs are confirmed against live page state before
        anything consequential.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        {docsNavigation
          .flatMap((s) => s.items)
          .filter((i) => i.href !== "/docs")
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg border border-line p-4 no-underline transition-colors hover:bg-black/[0.03]"
            >
              <span className="block text-[15px] font-medium text-ink">
                {item.name} →
              </span>
            </Link>
          ))}
      </div>
    </article>
  );
}
