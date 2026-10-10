// Snippets: the only JS that ever runs in-page for authoring. Fixed
// shapes — the agent supplies data (def + body), never page code.
// Pure builders + pure reply parsers: unit-tested offline, no browser.
export const CONTROLLER_MAP = "window.__agentWebmcp" as const

// Register: compile the body debugger-side (CSP-exempt), store one
// AbortController per name (unregisterTool does not exist upstream —
// removal is controller.abort()), register with { signal }.
// Re-register aborts the old first: overwrites are idempotent.
export const registerSnippet = (name: string, defJson: string, code: string): string =>
  "(async () => {" +
  " const execute = (" +
  code +
  ");" +
  " if (typeof execute !== 'function') return JSON.stringify({ error: 'code is not a function expression' });" +
  " const def = " +
  defJson +
  "; def.execute = execute;" +
  ` ${CONTROLLER_MAP} = ${CONTROLLER_MAP} ?? {};` +
  ` try { ${CONTROLLER_MAP}[${JSON.stringify(name)}]?.abort(); } catch {}` +
  " const controller = new AbortController();" +
  ` ${CONTROLLER_MAP}[${JSON.stringify(name)}] = controller;` +
  " try { await document.modelContext.registerTool(def, { signal: controller.signal }); }" +
  " catch (e) { return JSON.stringify({ error: String((e && e.message) || e).slice(0, 300) }); }" +
  " return JSON.stringify({ registered: def.name });" +
  "})()"

// Unregister: abort the stored controller. Missing controller means the
// page navigated (map wiped, tool gone with it) — reported, not silent.
export const unregisterSnippet = (name: string): string =>
  "(async () => {" +
  ` const c = ${CONTROLLER_MAP}?.[${JSON.stringify(name)}];` +
  ' if (!c) return JSON.stringify({ error: "no controller (page navigated or never registered here)" });' +
  ` try { c.abort(); delete ${CONTROLLER_MAP}[${JSON.stringify(name)}]; return "ok"; }` +
  " catch (e) { return JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) }); }" +
  "})()"

// Reply parsers: string|null refusal (null = ok). Pure.
export const parseRegisterReply = (value: unknown, name: string): string | null => {
  if (typeof value !== "string") return "page returned non-JSON (contract broken)."
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return "page returned non-JSON (contract broken)."
  }
  if (typeof parsed !== "object" || parsed === null || (parsed as { registered?: unknown }).registered !== name) {
    const refusal =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error).slice(0, 200)
        : "unexpected shape"
    return `page refused: ${refusal}`
  }
  return null
}

export const parseUnregisterReply = (value: unknown): string | null => {
  if (typeof value === "string" && value === "ok") return null
  if (typeof value === "string") {
    try {
      return `page refused: ${String((JSON.parse(value) as { error?: unknown }).error ?? value).slice(0, 200)}`
    } catch {
      return `page refused: ${value.slice(0, 200)}`
    }
  }
  return "page returned non-JSON (contract broken)."
}
