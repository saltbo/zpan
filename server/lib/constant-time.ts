/**
 * Length-aware constant-time string comparison. Avoids leaking how many
 * leading characters match via response timing — use for comparing secrets
 * (tokens, signatures) supplied by a caller.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
