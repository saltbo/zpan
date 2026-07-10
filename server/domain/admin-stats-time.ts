const HOUR_MS = 3_600_000

export function statsDayKey(date: Date, timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

export function localDateStart(date: string, timeZone: string): Date {
  const center = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(center)) throw new Error(`Invalid local date: ${date}`)
  let low = center - 18 * HOUR_MS
  let high = center + 18 * HOUR_MS
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (statsDayKey(new Date(middle), timeZone) < date) low = middle
    else high = middle
  }
  if (statsDayKey(new Date(high), timeZone) !== date) throw new Error(`Local date does not exist: ${date}/${timeZone}`)
  return new Date(high)
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
