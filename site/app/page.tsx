const REPO = "https://github.com/system1970/agent-webmcp";
const RELEASE = `${REPO}/releases/tag/v0.1.0`;
const DIRECTORY = "https://webmcp.com";

const BUTTON =
  "inline-flex min-h-9 w-fit max-w-full items-center justify-center gap-2 rounded-md border px-4 py-[7px] text-sm font-medium leading-5 whitespace-nowrap no-underline transition-colors";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="absolute -left-[9999px] top-0 z-10 rounded-md border border-line bg-canvas px-3 py-2 text-sm font-medium text-ink no-underline focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <div className="mx-auto grid min-h-svh w-[min(calc(100%_-_48px),1200px)] grid-rows-[auto_1fr_auto] py-[clamp(40px,6vw,72px)] max-[800px]:w-full max-[800px]:py-10 max-[800px]:ps-[calc(1rem_+_env(safe-area-inset-left,0px))] max-[800px]:pe-[calc(1rem_+_env(safe-area-inset-right,0px))]">
        <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pb-[clamp(32px,5vw,56px)]">
          <span className="font-mono text-[0.8125rem] font-medium leading-5 tracking-[-0.01em] text-ink">
            agent-webmcp
          </span>
          <nav aria-label="Primary" className="flex items-center gap-6">
            <a
              href={DIRECTORY}
              className="text-sm font-medium leading-5 text-ink-2 no-underline transition-colors hover:text-ink"
            >
              webmcp.com ↗
            </a>
          </nav>
        </header>

        <main id="main" className="grid">
          <section
            aria-labelledby="claim"
            className="my-auto grid grid-cols-12 items-start gap-x-6 max-[1080px]:block"
          >
            <div className="col-span-7 min-w-0">
              <h1
                id="claim"
                className="max-w-[20ch] text-display font-heading max-[600px]:text-display-sm"
              >
                Chrome is the server.
              </h1>
              <p className="mt-5 max-w-[60ch] text-lede text-ink-2">
                agent-webmcp is a WebMCP CLI for AI agents: one static Go
                binary that discovers and invokes page-registered tools in real
                Chrome sessions. ~15&nbsp;ms cold start, ~39&nbsp;ms
                round-trips. No daemon, no Node, no Playwright.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href={`${REPO}#install`}
                  className={`${BUTTON} border-ink bg-ink text-canvas hover:bg-[color-mix(in_oklab,var(--aw-ink)_86%,var(--aw-bg))]`}
                >
                  Install
                </a>
                <a href={REPO} className={`${BUTTON} border-line bg-canvas text-ink hover:bg-hover`}>
                  GitHub ↗
                </a>
              </div>
              <p className="mt-5 text-meta text-ink-2">
                <a href={RELEASE}>v0.1.0</a> · Chrome 149 or newer · Windows,
                macOS, Linux
              </p>
            </div>
            <div className="col-span-5 min-w-0 max-[1080px]:mt-8 max-[1080px]:max-w-2xl">
              <pre
                aria-label="The three commands that drive a session"
                className="overflow-x-auto rounded-lg border border-line bg-raised p-4 font-mono text-[0.8125rem] leading-[1.55] [font-variant-numeric:tabular-nums_slashed-zero]"
              >
                <code>{`$ agent-webmcp open <url> --session demo
$ agent-webmcp list --session demo
$ agent-webmcp invoke <tool> --params '{...}' \\
    --session demo`}</code>
              </pre>
            </div>
          </section>
        </main>

        <footer className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-[clamp(32px,5vw,56px)] text-meta text-ink-2">
          <span>MIT license</span>
          <span>© 2026 system1970</span>
        </footer>
      </div>
    </>
  );
}
