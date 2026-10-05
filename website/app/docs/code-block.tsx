"use client";

import { useState } from "react";

// Tiny docs tokenizer: comments, strings, flags, keywords, numbers,
// JSON keys. No dependency; bash/text share rules, json/javascript add
// their own. Unknown text stays plain — never miscolored.

type Tok = { t: string; k: string };

const KIND_CLASS: Record<string, string> = {
  plain: "text-ink",
  comment: "text-[var(--term-dim)]",
  prompt: "text-[var(--term-dim)]",
  string: "text-[var(--term-str)]",
  flag: "text-[var(--term-flag)]",
  keyword: "text-[var(--term-kw)]",
  number: "text-[var(--term-num)]",
  key: "text-[var(--term-key)]",
};

function tokenize(line: string, lang: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (t: string, k: string) => {
    if (t) out.push({ t, k });
  };
  // Leading `$ ` shell prompt dims out (bash/text only).
  if ((lang === "bash" || lang === "text") && /^\$\s/.test(line)) {
    const m = line.match(/^\$\s*/)![0];
    push(m, "prompt");
    i = m.length;
  }
  let buf = "";
  const flush = () => {
    push(buf, "plain");
    buf = "";
  };
  while (i < line.length) {
    const rest = line.slice(i);
    const ch = line[i];
    // Strings (all langs).
    if (ch === '"' || ch === "'") {
      flush();
      let j = i + 1;
      while (j < line.length && line[j] !== ch) {
        if (line[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, line.length);
      const raw = line.slice(i, j);
      const isKey =
        lang === "json" && /^"/.test(raw) && /^\s*:/.test(line.slice(j));
      push(raw, isKey ? "key" : "string");
      i = j;
      continue;
    }
    // Comments: # (bash/text), // (javascript).
    if (
      ch === "#" &&
      (lang === "bash" || lang === "text") &&
      (i === 0 || /\s/.test(line[i - 1]))
    ) {
      flush();
      push(line.slice(i), "comment");
      break;
    }
    if (ch === "/" && line[i + 1] === "/" && lang === "javascript") {
      flush();
      push(line.slice(i), "comment");
      break;
    }
    const mFlag = lang !== "json" && rest.match(/^--[A-Za-z][A-Za-z0-9_-]*/);
    if (mFlag) {
      flush();
      push(mFlag[0], "flag");
      i += mFlag[0].length;
      continue;
    }
    const mKw =
      lang === "javascript" &&
      rest.match(
        /^(const|return|function|new|for|while|if|else|try|catch|throw|let|var|of|in|typeof|await)\b/
      );
    if (mKw) {
      flush();
      push(mKw[0], "keyword");
      i += mKw[0].length;
      continue;
    }
    const mBool =
      (lang === "json" || lang === "javascript") &&
      rest.match(/^(true|false|null)\b/);
    if (mBool) {
      flush();
      push(mBool[0], "keyword");
      i += mBool[0].length;
      continue;
    }
    const mNum = rest.match(/^\d[\d.]*/);
    if (mNum) {
      flush();
      push(mNum[0], "number");
      i += mNum[0].length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

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
  const norm = lang === "js" ? "javascript" : lang;
  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-line bg-canvas">
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6">
        <code>
          {code.split("\n").map((line, li) => (
            <span key={li} className="block">
              {tokenize(line, norm).map((tok, ti) => (
                <span key={ti} className={KIND_CLASS[tok.k]}>
                  {tok.t}
                </span>
              ))}
              {line === "" ? " " : null}
            </span>
          ))}
        </code>
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
