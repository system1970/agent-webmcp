// Governor (log-only): per-session edit/shell log + idle summaries.
// Zero deps, no imports beside node:fs (tsconfig excludes .opencode/, so
// explicit `any` throughout). Every hook body is try/caught — logging
// must never break a session. No denies: observation only, v1.
//
// Packaging: default export {id, setup} per the v2 loader (a named export
// fails schema validation). setup's return is the hooks table:
// "tool.execute.before" fires per tool call, `event` per server event.
import { appendFileSync, mkdirSync } from "node:fs"

const LOG_CAP = 300
const SECRET = /([A-Za-z0-9_.-]*(?:key|token|secret|password|bearer)[A-Za-z0-9_.-]*\s*[:=]\s*)\S+/gi

const counts = new Map<string, { edit: number; shell: number }>()

const redact = (s: string): string =>
  s.replace(SECRET, "$1[redacted]").slice(0, LOG_CAP)

const sessionOf = (...candidates: Array<any>): string => {
  try {
    for (const c of candidates) {
      if (typeof c === "string" && c !== "") return c
    }
    return "unknown"
  } catch {
    return "unknown"
  }
}

const append = (ctx: any, session: string, line: string): void => {
  const root = String(ctx?.directory ?? process.cwd())
  mkdirSync(`${root}/reviews/.governor`, { recursive: true })
  appendFileSync(
    `${root}/reviews/.governor/${session}.log`,
    `${new Date().toISOString()} ${line}\n`
  )
}

const tally = (session: string, kind: "edit" | "shell"): void => {
  const c = counts.get(session) ?? { edit: 0, shell: 0 }
  c[kind]++
  counts.set(session, c)
}

export default {
  id: "agent-webmcp.governor",
  setup: async (ctx: any): Promise<any> => ({
    "tool.execute.before": async (input: any, output: any): Promise<void> => {
      try {
        // v2 shape: input = {tool, sessionID, input}; v1 compat: output.args.
        const tool = String(input?.tool ?? output?.tool ?? "unknown")
        const session = sessionOf(input?.sessionID, output?.sessionID)
        const args = input?.input ?? output?.args ?? {}
        if (tool === "edit" || tool === "write") {
          tally(session, "edit")
          append(ctx, session, `edit ${tool} ${redact(String(args.filePath ?? "?"))}`)
        } else if (tool === "bash" || tool === "shell" || tool === "execute") {
          tally(session, "shell")
          append(ctx, session, `shell ${redact(String(args.command ?? "?"))}`)
        }
      } catch {
        // Log-only: never break the session.
      }
    },
    event: async (input: any): Promise<void> => {
      try {
        const event = input?.event ?? input
        if (event?.type !== "session.idle") return
        const session = sessionOf(event?.properties?.sessionID, event?.sessionID)
        const c = counts.get(session) ?? { edit: 0, shell: 0 }
        append(ctx, session, `idle edits=${c.edit} shells=${c.shell}`)
      } catch {
        // Log-only: never break the session.
      }
    },
  }),
}
