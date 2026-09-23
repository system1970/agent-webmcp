import Link from "next/link";

import SiteNav from "../site-nav";
import { docsNavigation } from "./navigation";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a
        href="#docs-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink no-underline"
      >
        Skip to content
      </a>
      <SiteNav current="/" />
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-5 py-8 sm:px-8 lg:flex-row">
        <nav aria-label="Docs" className="w-full shrink-0 lg:w-56">
          <div className="flex flex-row gap-6 overflow-x-auto lg:sticky lg:top-20 lg:flex-col lg:gap-5 lg:overflow-visible">
            {docsNavigation.map((section) => (
              <div key={section.title ?? "top"}>
                {section.title ? (
                  <p className="mb-1.5 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                    {section.title}
                  </p>
                ) : null}
                <ul className="flex flex-row gap-1 lg:flex-col">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13.5px] text-ink-2 transition-colors hover:bg-black/[0.04] hover:text-ink"
                      >
                        {item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <main id="docs-main" className="min-w-0 flex-1 pb-16">
          {children}
        </main>
      </div>
    </>
  );
}
