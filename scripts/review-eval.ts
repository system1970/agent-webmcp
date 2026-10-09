// ReviewBench-lite: review-driven fixes stay fixed. Usage:
// `bun ./scripts/review-eval.ts`. No browser, no network, no model.
//
// Each golden in review-eval.json is a finding a past review caught.
// `fixed`/`accepted` rows carry a `check` (file contains/absent a string):
// VERIFIED means the fix landed and still holds; REGRESSED means a later
// change silently lost it and fails the run (exit 1). `tracked` rows are
// open classes with no code assertion yet — listed, never failing.
// Score = verified / (verified + regressed); tracked shows the backlog.
type Check = { file: string; contains?: string; absent?: string }
type Golden = {
  id: string; location: string; problem: string; source: string
  status: "fixed" | "accepted" | "tracked"; check: Check | null
}

const root = `${import.meta.dir}/..`
const goldens = await Bun.file(`${root}/scripts/review-eval.json`).json() as Array<Golden>
let verified = 0
let regressed = 0
let tracked = 0
for (const g of goldens) {
  if (g.check === null || g.status === "tracked") {
    tracked++
    console.log(`TRACKED ${g.id} ${g.location} :: ${g.problem.slice(0, 90)}`)
    continue
  }
  const text = await Bun.file(`${root}/${g.check.file}`).text().catch(() => "")
  const holds = text === ""
    ? false
    : g.check.contains !== undefined
      ? text.includes(g.check.contains)
      : !text.includes(g.check.absent ?? "")
  if (text === "") {
    regressed++
    console.log(`REGRESSED ${g.id} ${g.location} :: file unreadable (${g.check.file})`)
  } else if (holds) {
    verified++
    console.log(`VERIFIED ${g.id} ${g.location}`)
  } else {
    regressed++
    const want = g.check.contains !== undefined ? `want contains '${g.check.contains}'` : `want absent '${g.check.absent}'`
    console.log(`REGRESSED ${g.id} ${g.location} :: ${want} (${g.check.file})`)
  }
}
const denom = verified + regressed
console.log(`review-eval: ${verified}/${denom} verified, ${tracked} tracked${denom > 0 ? ` (${Math.round((verified / denom) * 100)}%)` : ""}`)
if (regressed > 0) process.exit(1)
