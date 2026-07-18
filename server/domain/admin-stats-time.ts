export function statsDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function utcDateStart(date: string): Date {
  const value = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(value.getTime()) || statsDayKey(value) !== date) throw new Error(`Invalid UTC date: ${date}`)
  return value
}

export function addCalendarDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}
