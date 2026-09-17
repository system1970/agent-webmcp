"use client";

import { useState } from "react";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-md border border-line bg-canvas px-3 py-1.5 font-mono text-xs leading-4 text-ink-2 transition-colors hover:bg-hover hover:text-ink"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
