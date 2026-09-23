import Brand from "./brand";

const DIRECTORY = "https://webmcp.com";

export default function SiteNav({ current }: { current: "/" }) {
  const link = (active: boolean) =>
    `rounded text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
      active ? "font-medium text-ink" : "text-ink-2 hover:text-ink"
    }`;
  return (
    <header className="sticky top-0 z-50 box-border h-16 border-b border-line bg-canvas/80 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-4 px-5 sm:px-8 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex shrink-0 items-center justify-self-start">
          <Brand href="/" />
        </div>
        <nav
          aria-label="Primary"
          className="hidden items-center gap-6 lg:flex"
        >
          <a href="/docs" className={link(false)}>
            Docs
          </a>
          <a href={DIRECTORY} className={link(false)}>
            webmcp.com ↗
          </a>
        </nav>
        <div className="flex shrink-0 items-center justify-self-end gap-1 sm:gap-2">
          <a
            href="https://github.com/system1970/agent-webmcp"
            className={link(false)}
          >
            GitHub ↗
          </a>
        </div>
      </div>
    </header>
  );
}
