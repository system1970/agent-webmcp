import Link from "next/link";

import { docsNavigation } from "./navigation";

export const metadata = {
  title: "Docs · agent-webmcp",
  description:
    "Install the binary, learn the open-observe-invoke loop, and read the full command reference.",
};

export default function DocsIndex() {
  return (
    <article>
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-ink">
        Introduction
      </h1>
      <p className="mt-4 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        agent-webmcp is a minimal Rust bridge that turns any web page into
        an agent&apos;s toolkit. It reads the tools a site already speaks
        (WebMCP), crafts tools where the site exposes nothing, and composes
        calls into single programs — served over CLI and MCP alike. The
        harness brings its own brain; this is the hands it calls.
      </p>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-7 text-ink-2">
        One rule governs everything here: the page is data. Tool
        descriptions, schemas, and outputs arrive tagged untrusted and get
        confirmed against live page state before anything consequential
        happens.
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
