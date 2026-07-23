export const STORAGE_USAGE_CATEGORIES = [
  'photos',
  'videos',
  'music',
  'documents',
  'archives',
  'other',
  'image_hosting',
  'trash',
] as const

export type StorageUsageCategory = (typeof STORAGE_USAGE_CATEGORIES)[number]

const ARCHIVE_MIME_TYPES = new Set([
  'application/gzip',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-bzip2',
  'application/x-rar-compressed',
  'application/x-tar',
  'application/zip',
])

const DOCUMENT_MIME_TYPES = new Set([
  'application/epub+zip',
  'application/msword',
  'application/pdf',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export function classifyStorageUsage(mimeType: string): Exclude<StorageUsageCategory, 'image_hosting' | 'trash'> {
  const normalized = mimeType.trim().toLowerCase()
  if (normalized.startsWith('image/')) return 'photos'
  if (normalized.startsWith('video/')) return 'videos'
  if (normalized.startsWith('audio/')) return 'music'
  if (normalized.startsWith('text/') || DOCUMENT_MIME_TYPES.has(normalized)) return 'documents'
  if (ARCHIVE_MIME_TYPES.has(normalized)) return 'archives'
  return 'other'
}

export interface StorageUsageBreakdown {
  category: StorageUsageCategory
  bytes: number
  fileCount: number
}

export interface StorageUsageResponse {
  usedBytes: number
  quotaBytes: number
  currentPlan: {
    name: string
    storageBytes: number
    subscription: boolean
  } | null
  breakdowns: StorageUsageBreakdown[]
  updatedAt: string | null
}

export interface StorageUsageItem {
  id: string
  name: string
  type: string
  size: number
  updatedAt: string
  source: 'files' | 'image_hosting' | 'trash'
}
