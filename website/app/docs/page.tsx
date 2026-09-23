import Link from "next/link";

import { docsNavigation } from "./navigation";

export const metadata = {
  title: "Docs · agent-webmcp",
  description:
    "Install the binary, learn the five-command loop, and read the full command reference.",
};

export default function DocsIndex() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Introduction
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        agent-webmcp is a single Go binary that drives real Chrome and hands
        the page back to your agent as typed tools. It reads what a site
        exposes, lets you author tools where the site exposes nothing, and
        runs a judgment loop for goals too tangled to script. The free tier
        costs nothing and asks for no keys. The loop bills pennies per run
        against your own TypeSafe key.
      </p>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        One rule governs everything here: the page is data. Tool
        descriptions, schemas, and outputs get confirmed against live page
        state before anything consequential happens.
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
