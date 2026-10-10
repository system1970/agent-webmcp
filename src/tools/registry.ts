// Registry: the whole tool surface in one list. One file per tool, one
// entry here. execute arrives with the Runner (its only caller).
import { close } from "./close.ts"
import { execute } from "./execute.ts"
import { list } from "./list.ts"
import { open } from "./open.ts"
import { register } from "./register.ts"
import { search } from "./search.ts"
import { unregister } from "./unregister.ts"
import type { WebmcpTool } from "./definition.ts"

export const allTools: ReadonlyArray<WebmcpTool> = [open, list, search, register, execute, close, unregister]

export const findTool = (name: string): WebmcpTool | undefined => allTools.find((tool) => tool.name === name)
