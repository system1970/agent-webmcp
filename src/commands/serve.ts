// MCP serve over stdio. Rule: stdout is the protocol — diagnostics to
// stderr only. Unknown tools fail as isError, never as throws. Layers are
// provided per call (serve outlives any single composition).
import { Console, Effect, Layer } from "effect"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { allTools, findTool } from "../tools/registry.ts"
import { ToolFailed } from "../tools/definition.ts"
import type { VerbServices } from "../tools/definition.ts"
import { cliVersion } from "../version.ts"

export const cmdMcpList = (): Effect.Effect<void> =>
  Effect.sync(() => {
    console.log(JSON.stringify(allTools.map((tool) => ({ name: tool.name, description: tool.description }))))
  })

export const cmdMcpServe = (layers: Layer.Layer<VerbServices>): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    const server = new Server({ name: "agent-webmcp", version: cliVersion }, { capabilities: { tools: {} } })
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: allTools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    }))
    server.setRequestHandler(CallToolRequestSchema, (request) => {
      const tool = findTool(request.params.name)
      if (tool === undefined) {
        return Promise.resolve({ content: [{ type: "text", text: `unknown tool: ${request.params.name}` }], isError: true })
      }
      return Effect.runPromise(
        tool.execute(request.params.arguments ?? {}, {}).pipe(Effect.provide(layers))
      ).then(
        (value) => ({ content: [{ type: "text", text: value.content }] }),
        (error) => ({
          content: [{ type: "text", text: error instanceof ToolFailed ? error.message : String(error) }],
          isError: true,
        })
      )
    })
    yield* Effect.promise(() => server.connect(new StdioServerTransport()))
    yield* Console.error("agent-webmcp: serving tools over stdio")
  })
