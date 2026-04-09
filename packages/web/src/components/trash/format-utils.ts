export function formatDate(timestamp: string): string {
  const d = new Date(timestamp)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const size = (bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)
  return `${size} ${units[i]}`
}
