export function formatDate(value: number | string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

// Up to two uppercase initials from a display name; safe on empty/odd input.
export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

// "used / total" with ∞ for an unlimited (0 or negative) quota.
export function formatStorageUsage(used: number, total: number): string {
  return `${formatSize(used)} / ${total <= 0 ? '∞' : formatSize(total)}`
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = (bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)
  return `${size} ${units[i]}`
}

export function formatMoney(amount: number, currency: string): string {
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
}

/** Locale-aware currency from a minor-unit (cents) amount, e.g. 1299 → "$12.99". */
export function formatCurrency(amountCents: number, currency: string, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(
    amountCents / 100,
  )
}
