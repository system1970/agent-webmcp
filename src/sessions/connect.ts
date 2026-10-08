import { Effect } from "effect"
import { dial, reattach } from "../transport/client.ts"
import type { Connection } from "../transport/client.ts"
import { browserWs } from "../transport/devtools.ts"
import { loadSession } from "./store.ts"
import type { SessionRecord } from "./store.ts"

// Dial the session's browser and reattach its target. Fresh socket +
// fresh CDP session per command: nothing live persists between CLI
// invocations except the record on disk.
export const withSession = Effect.fn("sessions.withSession")(function* <A, E>(
  handle: string,
  use: (conn: Connection, record: SessionRecord, sessionId: string) => Effect.Effect<A, E>
) {
  const record = yield* loadSession(handle)
  const ws = yield* browserWs(record.browserHttp)
  const conn = yield* dial(ws)
  return yield* Effect.ensuring(
    Effect.gen(function* () {
      const { sessionId } = yield* reattach(conn, record.targetId)
      return yield* use(conn, record, sessionId)
    }),
    conn.close
  )
})
