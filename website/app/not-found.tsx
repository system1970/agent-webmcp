import SiteNav from "./site-nav";

export const metadata = {
  title: "Not found · agent-webmcp",
  description: "This page does not exist. Explore capabilities or go home.",
};

export default function NotFound() {
  return (
    <>
      <SiteNav current="/" />
      <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[880px] flex-col items-start justify-center px-6 py-16">
        <p className="font-mono text-sm leading-5 text-ink-2">404</p>
        <h1 className="text-display font-heading mt-3 max-[600px]:text-display-sm">
          This page doesn&apos;t exist.
        </h1>
        <p className="mt-4 max-w-[52ch] text-lede text-ink-2">
          The page you&apos;re looking for moved or never existed.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="/"
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-ink bg-ink px-4 py-[7px] text-sm font-medium leading-5 text-canvas no-underline hover:opacity-90"
          >
            Go home
          </a>
        </div>
      </div>
    </>
  );
}
