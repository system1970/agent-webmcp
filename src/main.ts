import { Console, Effect } from "effect"

const name = Bun.argv[2] ?? "world"

const main = Console.log(`hello, ${name}!`)

Effect.runPromise(main).catch((cause) => {
  console.error(cause)
  process.exit(1)
})
