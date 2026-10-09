import { Console, Deferred, Effect } from "effect"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js"
import { allTools, findTool } from "../tools/registry.ts"
import { ToolFailed } from "../tools/definition.ts"
import { getVersion } from "../version.ts"

// Serve the tool registry as an MCP server over stdio. Connect from any MCP
// client (pi: `pi --tools 'mcp__webmcp__*'` with a stdio entry pointing here).
//
// Rule: stdout is the protocol. Never write to stdout in this process —
// diagnostics go to stderr only.
export const mcpServe: Effect.Effect<void, Error> = Effect.gen(function*() {
  const version = yield* getVersion
  const server = new Server(
    { name: "agent-webmcp", version },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = findTool(request.params.name)
    if (tool === undefined) {
      return {
        content: [{ type: "text", text: `unknown tool: ${request.params.name}` }],
        isError: true
      }
    }
    const result = await Effect.runPromise(tool.execute(request.params.arguments ?? {})).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error })
    )
    if (!result.ok) {
      const message = result.error instanceof ToolFailed
        ? `${result.error.tool}: ${result.error.message}`
        : String(result.error)
      return { content: [{ type: "text", text: message }], isError: true }
    }
    return { content: [{ type: "text", text: result.value.content }] }
  })

  yield* Effect.promise(() => server.connect(new StdioServerTransport()))
  yield* Console.error("agent-webmcp: serving tools over stdio")
  // Self-reap on client disconnect: the SDK never listens for stdin
  // EOF, and Bun busy-spins EOF-stdin loops (~100% CPU, zero syscalls).
  // No server.close on this path: best-effort reap — EOF means the
  // reader is gone, but a pipelined half-close (stdin EOF while a
  // response is still being written) may drop one trailing response.
  // Acceptable: the client that half-closed isn't reading anyway.
  // Double-arm (end+close) is benign: the second Deferred.succeed
  // returns false on a completed cell.
  const closed = yield* Deferred.make<void>()
  yield* Effect.scoped(
    Effect.gen(function*() {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const done = (): void => {
            Effect.runFork(Deferred.succeed(closed, undefined))
          }
          // Fast-path: a client that already disconnected (stdin EOF
          // before we attached) never fires end/close again — check
          // ended-state synchronously or the await below never resolves
          // (the same orphan, one race earlier).
          const stdin = process.stdin as NodeJS.ReadableStream & { readableEnded?: boolean }
          if (stdin.readableEnded === true) {
            done()
          } else {
            process.stdin.once("end", done)
            process.stdin.once("close", done)
          }
          return done
        }),
        (done) =>
          Effect.sync(() => {
            process.stdin.off("end", done)
            process.stdin.off("close", done)
          })
      )
      yield* Deferred.await(closed)
    })
  )
})
