import SiteNav from "../site-nav";
import { DocsSidebarNav } from "./sidebar-nav";

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
          <DocsSidebarNav />
        </nav>
        <main id="docs-main" className="min-w-0 flex-1 pb-16">
          {children}
        </main>
      </div>
    </>
  );
}
