import type { StorageObject } from '@zpan/shared'

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

export function isFolder(obj: StorageObject): boolean {
  return obj.dirtype > 0
}

export function mimeCategory(type: string): string {
  if (!type) return 'file'
  const prefix = type.split('/')[0]
  if (['image', 'video', 'audio', 'text'].includes(prefix)) return prefix
  if (type === 'application/pdf') return 'pdf'
  return 'file'
}

const TYPE_LABEL: Record<string, string> = {
  image: 'Images',
  video: 'Videos',
  audio: 'Audio',
  text: 'Documents',
  application: 'Documents',
}

export function typeLabelFromParam(type: string | undefined): string | null {
  if (!type) return null
  return TYPE_LABEL[type] ?? type
}
