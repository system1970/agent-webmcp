// Single path, dev and binary alike: versions come from the generated
// module. No file reads, no defines.
import { CLI_VERSION, EFFECT_VERSION } from "./generated/versions.ts"

export const CLI_NAME = "agent-webmcp" as const
export const cliVersion = CLI_VERSION
export const effectVersion = EFFECT_VERSION
