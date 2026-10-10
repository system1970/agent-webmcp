// Classifier: invoke failures sorted into exactly four codes. Pure —
// the rot signal without a browser. `inCatalog` is the build-time
// catalog (a tool absent there was never live or the SPA cleared it).
export type CallClass = "tool-vanished" | "page-refused" | "transport" | "args-rejected"

export interface Classified {
  readonly code: CallClass
  readonly guidance: string
}

export const classifyCallFailure = (options: {
  toolName: string
  inCatalog: boolean
  reason: string
  message: string
}): Classified => {
  const { toolName, inCatalog, reason, message } = options
  if (!inCatalog) {
    return {
      code: "tool-vanished",
      guidance: `'${toolName}' is not in the live catalog (SPA route cleared it, or it never registered) — re-list; if a file tool, re-open to re-apply, else re-author.`,
    }
  }
  if (reason === "timeout" || reason === "connect") {
    return {
      code: "transport",
      guidance: `browser unreachable during '${toolName}' (${message.slice(0, 120)}) — retry once, then re-list; the browser may be wedged.`,
    }
  }
  if (/schema|argument|invalid|required|unknown key/i.test(message)) {
    return {
      code: "args-rejected",
      guidance: `'${toolName}' rejected the input — rewrite args against its schema (list ${toolName} for the record).`,
    }
  }
  return {
    code: "page-refused",
    guidance: `'${toolName}' refused at runtime (${message.slice(0, 120)}) — page logic changed; mark suspect, verify the effect path, re-author if the page moved.`,
  }
}

// Strict: unknown input keys rejected host-side against the SAVED spec
// (snippet stays dumb). Returns the offending keys, [] = clean.
// Non-object schemas or missing properties tables skip (no opinion).
export const checkStrict = (inputSchema: unknown, args: unknown): Array<string> => {
  if (typeof inputSchema !== "object" || inputSchema === null) return []
  if (typeof args !== "object" || args === null || Array.isArray(args)) return []
  const props = (inputSchema as { properties?: unknown }).properties
  if (typeof props !== "object" || props === null || Array.isArray(props)) return []
  const known = new Set(Object.keys(props as Record<string, unknown>))
  return Object.keys(args as Record<string, unknown>).filter((k) => !known.has(k))
}
