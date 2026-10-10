// SessionStore: disk handles. One dir per handle under the root:
// record.json (the session), tools.json (last snapshot), calls.log
// (append-only). Crash-safe by construction: a dead browser is a
// transport failure on next verb, never a corrupt store.
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { mkdirSync, readdirSync, rmSync } from "node:fs"
import { StoreFailed } from "./errors.ts"

export const SessionRecord = Schema.Struct({
  handle: Schema.String,
  url: Schema.String,
  origin: Schema.String,
  httpEndpoint: Schema.String,
  targetId: Schema.String,
  ownBrowser: Schema.Boolean,
  pid: Schema.Number,
  createdAt: Schema.Number,
  authored: Schema.Array(Schema.String),
  suspect: Schema.Array(Schema.String),
  // Owned-browser profile dir (removed on close — a dirty left-behind
  // profile offers "Restore pages?" next launch). Optional: pre-field
  // records predate it; close derives from the port then.
  profileDir: Schema.optional(Schema.String),
})
export type SessionRecord = typeof SessionRecord.Type

export interface StoreApi {
  readonly save: (record: SessionRecord) => Effect.Effect<void, StoreFailed>
  readonly load: (handle: string) => Effect.Effect<SessionRecord, StoreFailed>
  readonly remove: (handle: string) => Effect.Effect<void, StoreFailed>
  readonly list: () => Effect.Effect<ReadonlyArray<SessionRecord>, StoreFailed>
  readonly appendLog: (handle: string, line: string) => Effect.Effect<void, StoreFailed>
}

export class SessionStore extends Context.Service<SessionStore, StoreApi>()("SessionStore", {}) {
  static Disk = (root: string): Layer.Layer<SessionStore> => Layer.succeed(SessionStore, makeDisk(root))
  static Memory = (): Layer.Layer<SessionStore> =>
    Layer.effect(
      SessionStore,
      Ref.make(new Map<string, { record: SessionRecord; log: Array<string> }>()).pipe(
        Effect.map((ref) => makeMemory(ref))
      )
    )
}

const dirOf = (root: string, handle: string): string => `${root}/${handle}`

const makeDisk = (root: string): StoreApi => {
  return {
    save: (record) =>
      Effect.tryPromise({
        try: async () => {
          mkdirSync(dirOf(root, record.handle), { recursive: true })
          await Bun.write(`${dirOf(root, record.handle)}/record.json`, JSON.stringify(record))
        },
        catch: (err) =>
          new StoreFailed({ reason: "io", handle: record.handle, message: String(err), fix: "disk or permissions." }),
      }),
    load: (handle) =>
      Effect.gen(function* () {
        const text = yield* Effect.tryPromise({
          try: () => Bun.file(`${dirOf(root, handle)}/record.json`).text(),
          catch: () =>
            new StoreFailed({
              reason: "missing",
              handle,
              message: "no such session",
              fix: "open again — handles die with their browser.",
            }),
        })
        return yield* Effect.try({
          try: () => {
            const parsed: unknown = JSON.parse(text)
            Schema.asserts(SessionRecord, parsed)
            return parsed
          },
          catch: () =>
            new StoreFailed({
              reason: "corrupt",
              handle,
              message: "record is unparseable",
              fix: "close the handle and open again.",
            }),
        })
      }),
    remove: (handle) =>
      Effect.sync(() => {
        rmSync(dirOf(root, handle), { recursive: true, force: true })
      }),
    list: () =>
      Effect.tryPromise({
        try: async () => {
          const out: Array<SessionRecord> = []
          for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue
            try {
              const parsed: unknown = JSON.parse(await Bun.file(`${root}/${entry.name}/record.json`).text())
              Schema.asserts(SessionRecord, parsed)
              out.push(parsed)
            } catch {
              // Half-written records don't exist as far as list cares.
            }
          }
          return out
        },
        catch: (err) => new StoreFailed({ reason: "io", message: String(err), fix: "disk or permissions." }),
      }),
    appendLog: (handle, line) =>
      Effect.tryPromise({
        try: async () => {
          const path = `${dirOf(root, handle)}/calls.log`
          const prev = await Bun.file(path)
            .text()
            .catch(() => "")
          await Bun.write(path, `${prev}${new Date().toISOString()} ${line}\n`)
        },
        catch: (err) => new StoreFailed({ reason: "io", handle, message: String(err), fix: "disk or permissions." }),
      }),
  }
}

const makeMemory = (ref: Ref.Ref<Map<string, { record: SessionRecord; log: Array<string> }>>): StoreApi => ({
  save: (record) => Ref.update(ref, (m) => m.set(record.handle, { record, log: m.get(record.handle)?.log ?? [] })).pipe(Effect.asVoid),
  load: (handle) =>
    Ref.get(ref).pipe(
      Effect.flatMap((m) => {
        const entry = m.get(handle)
        return entry === undefined
          ? Effect.fail(
              new StoreFailed({ reason: "missing", handle, message: "no such session", fix: "open again." })
            )
          : Effect.succeed(entry.record)
      })
    ),
  remove: (handle) => Ref.update(ref, (m) => (m.delete(handle), m)).pipe(Effect.asVoid),
  list: () => Ref.get(ref).pipe(Effect.map((m) => [...m.values()].map((e) => e.record))),
  appendLog: (handle, line) =>
    Ref.get(ref).pipe(
      Effect.flatMap((m) => {
        const entry = m.get(handle)
        if (entry === undefined) {
          return Effect.fail(
            new StoreFailed({ reason: "missing", handle, message: "no such session", fix: "open again." })
          )
        }
        entry.log.push(line)
        return Effect.void
      })
    ),
})
