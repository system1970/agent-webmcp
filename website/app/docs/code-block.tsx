"use client";

import { useState } from "react";

export function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — selection still works */
    }
  };
  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-line bg-canvas">
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-ink">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code block"
        className="absolute right-2 top-2 rounded-md border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-ink-2 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="sr-only">{lang}</span>
    </div>
  );
}
