import { Effect } from "effect"
import { CLI_VERSION, EFFECT_VERSION } from "./generated/versions.ts"

// Single path, dev and binary alike: versions are generated into
// `src/generated/versions.ts` by `bun run gen`. No file reads, no defines.
export const getVersion: Effect.Effect<string, Error> = Effect.succeed(CLI_VERSION)

export const getEffectVersion: Effect.Effect<string, Error> = Effect.succeed(EFFECT_VERSION)
