export default function Brand({ href }: { href?: string }) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/orkestrate-brand-mark.png"
        alt=""
        aria-hidden="true"
        width={20}
        height={20}
        className="h-5 w-5 shrink-0 object-contain"
      />
      <a
        href="https://orkestrate.space"
        className="text-sm font-semibold tracking-tight text-ink no-underline hover:opacity-80"
      >
        Orkestrate
      </a>
      <span aria-hidden="true" className="text-sm leading-5 text-ink-2">
        /
      </span>
      <a
        href="/"
        className="text-sm text-ink-2 no-underline hover:text-ink"
        aria-current={href === "/" ? undefined : "page"}
      >
        agent-webmcp
      </a>
    </>
  );
  const cls = "flex items-center gap-2 text-ink no-underline";
  if (href) {
    return (
      <span className={cls} aria-label="Orkestrate agent-webmcp">
        {inner}
      </span>
    );
  }
  return (
    <span className={cls} aria-label="Orkestrate agent-webmcp">
      {inner}
    </span>
  );
}
