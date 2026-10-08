import { Effect } from "effect"

// Single place the CLI version comes from: our own package.json, read at
// runtime so the two can never disagree.
export const getVersion: Effect.Effect<string, Error> = Effect.promise(async () => {
  const file = Bun.file(new URL("../package.json", import.meta.url))
  const pkg = (await file.json()) as { version?: string }
  return pkg.version ?? "0.0.0"
})
