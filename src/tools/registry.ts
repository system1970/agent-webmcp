import type { WebmcpTool } from "./definition.ts"
import { search } from "./search.ts"
import { execute } from "./execute.ts"

// The whole tool surface, in one list. `mcp list` prints it, `mcp serve`
// exposes it. To add a tool: write `src/tools/<name>.ts`, add it here.
export const allTools: ReadonlyArray<WebmcpTool> = [search, execute]

export const findTool = (name: string): WebmcpTool | undefined =>
  allTools.find((tool) => tool.name === name)
