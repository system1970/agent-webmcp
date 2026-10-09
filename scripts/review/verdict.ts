// Machine-readable verdict: the reviewer prompt demands the exact line,
// so parse it. Fallback is honest about being a guess (missing verdict =
// advisory text, never a green signal — see gateRed).
export const parseVerdict = (text: string): number | null => {
  const m = /Verdict:\s*(\d+)\s*BLOCKING/i.exec(text)
  if (m !== null) return Number(m[1])
  if (/no blocking/i.test(text)) return 0
  return null
}

// Gate decision, fail-closed: null means unconfirmable, which is red.
// A verifier-cleared run (blocking>0, confirmed 0) is the only green
// path that ever saw a BLOCKING.
export const gateRed = (blocking: number | null, confirmed: number | null): boolean =>
  blocking === null || (confirmed ?? blocking) > 0
