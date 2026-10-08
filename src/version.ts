import { Effect } from "effect"

// Baked at compile time by `scripts/compile.ts` via `--define`. In dev
// (`bun src/main.ts`) the identifiers are undefined and we read package.json
// off disk instead. `typeof` guards keep the dev path from throwing.
declare const AGENT_WEBMCP_VERSION: string | undefined
declare const EFFECT_VERSION: string | undefined

const bakedCli: string | undefined =
  typeof AGENT_WEBMCP_VERSION === "string" && AGENT_WEBMCP_VERSION !== ""
    ? AGENT_WEBMCP_VERSION
    : undefined

const bakedEffect: string | undefined =
  typeof EFFECT_VERSION === "string" && EFFECT_VERSION !== "" ? EFFECT_VERSION : undefined

const readJsonVersion = (url: URL): Effect.Effect<string, Error> =>
  Effect.promise(async () => {
    const pkg = (await Bun.file(url).json()) as { version?: string }
    return pkg.version ?? "unknown"
  })

// Single place the CLI version comes from: baked in at compile time, or our
// own package.json at runtime in dev. The two can never disagree.
export const getVersion: Effect.Effect<string, Error> =
  bakedCli !== undefined ? Effect.succeed(bakedCli) : readJsonVersion(new URL("../package.json", import.meta.url))

export const getEffectVersion: Effect.Effect<string, Error> =
  bakedEffect !== undefined
    ? Effect.succeed(bakedEffect)
    : readJsonVersion(new URL("../../node_modules/effect/package.json", import.meta.url))
