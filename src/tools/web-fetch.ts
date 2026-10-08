import { Effect, Schema } from "effect"
import type { WebmcpTool } from "./definition.ts"
import { ToolFailed } from "./definition.ts"

const MAX_BODY_CHARS = 8000

const Input = Schema.Struct({
  url: Schema.String
})

// Fetch a URL and return status plus truncated text. Read-only: HTTP errors
// still return data (the status line tells the story). Only network failures
// and invalid input become `ToolFailed`.
export const webFetch: WebmcpTool = {
  name: "web_fetch",
  description: "GET a URL and return the HTTP status plus the first 8000 characters of the body as text.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The http(s) URL to fetch." }
    },
    required: ["url"],
    additionalProperties: false
  },
  execute: (args) =>
    Effect.gen(function*() {
      const input = yield* Schema.decodeUnknownEffect(Input)(args).pipe(
        Effect.mapError((issue) => new ToolFailed({ tool: "web_fetch", message: String(issue) }))
      )
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(input.url, {
            headers: { "user-agent": "agent-webmcp/0.0.1" },
            redirect: "follow"
          }),
        catch: (cause) => new ToolFailed({ tool: "web_fetch", message: `fetch failed: ${String(cause)}` })
      })
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new ToolFailed({ tool: "web_fetch", message: `read body failed: ${String(cause)}` })
      })
      const truncated = body.length > MAX_BODY_CHARS
        ? body.slice(0, MAX_BODY_CHARS) + `\n…[truncated at ${MAX_BODY_CHARS} chars]`
        : body
      return {
        content: `HTTP ${response.status} ${response.statusText}\ncontent-type: ${response.headers.get("content-type") ?? "unknown"}\n\n${truncated}`
      }
    })
}
