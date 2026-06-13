// The org's traffic accounting period, `YYYY-MM` in UTC. Pure.
export function currentTrafficPeriod(now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${now.getUTCFullYear()}-${month}`
}
