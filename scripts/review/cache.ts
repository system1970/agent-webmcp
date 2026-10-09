// Patch cache: same diff + same plan = same verdict. Reruns exit in
// seconds instead of spending another model call. Lives under reviews/
// (gitignored, local only) beside the records.
import { createHash } from "node:crypto"

export const CACHE_PATH = "reviews/.patch-cache.json"

export interface CacheEntry {
  readonly stamp: string
  readonly tier: string
  readonly verdict: string
  readonly blocking: number
}

export const sha12 = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 12)

export const cacheKey = (patchSha: string, staged: boolean, planSha: string): string =>
  `${patchSha}${staged ? "-staged" : ""}+${planSha.slice(0, 8)}`

export const stamp = (): string => {
  const now = new Date()
  const p = (n: number): string => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
}

export const readCache = async (): Promise<Record<string, CacheEntry>> => {
  try {
    return await Bun.file(CACHE_PATH).json() as Record<string, CacheEntry>
  } catch {
    return {}
  }
}

export const writeCache = async (key: string, entry: CacheEntry): Promise<void> => {
  const cache = await readCache()
  cache[key] = entry
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2))
}
