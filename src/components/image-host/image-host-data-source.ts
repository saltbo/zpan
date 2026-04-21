import { DirType } from '@shared/constants'
import type { ImageHosting, StorageObject } from '@shared/types'
import { confirmIhostImage, createIhostImagePresign, deleteIhostImage, listIhostImages, uploadToS3 } from '@/lib/api'

// Extended StorageObject that carries image-host specific fields.
// The extra fields are opaque to FileManager but used by ImageHostView handlers.
export interface IhostItem extends StorageObject {
  token: string
  url: string
  dimensions: string | null
  accessCount: number
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  }
  return map[mime] ?? 'bin'
}

function toIhostItem(img: ImageHosting): IhostItem {
  const name = img.path.split('/').pop() ?? img.path
  const dimensions = img.width != null && img.height != null ? `${img.width}×${img.height}` : null

  return {
    // StorageObject fields
    id: img.id,
    orgId: img.orgId,
    alias: img.path,
    name,
    type: img.mime,
    size: img.size,
    dirtype: DirType.FILE,
    parent: '',
    object: img.storageKey,
    storageId: img.storageId,
    status: 'active' as const,
    createdAt: img.createdAt,
    updatedAt: img.createdAt,
    // IhostItem extra fields
    token: img.token,
    url: `/r/${img.token}.${mimeToExt(img.mime)}`,
    dimensions,
    accessCount: img.accessCount,
  }
}

function deriveDefaultPath(file: File): string {
  const ext = mimeToExt(file.type) || file.name.split('.').pop() || 'bin'
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  const ts = Date.now()
  return `${ts}_${base}.${ext}`
}

async function uploadImage(file: File): Promise<void> {
  const path = deriveDefaultPath(file)
  const draft = await createIhostImagePresign({ path, mime: file.type, size: file.size })
  await uploadToS3(draft.uploadUrl, file)
  await confirmIhostImage(draft.id)
}

export const imageHostDataSource = {
  queryKeyPrefix: ['ihost', 'images'] as const,

  async list(_path: string, _opts: { filterType?: string; search?: string }) {
    const result = await listIhostImages({ limit: 200 })
    return { items: result.items.map(toIhostItem) }
  },

  upload: uploadImage,

  async delete(id: string) {
    await deleteIhostImage(id)
  },

  getThumbnailUrl(item: StorageObject): string | null {
    const ihostItem = item as IhostItem
    if (!ihostItem.token) return null
    return ihostItem.url
  },

  getShareUrl(item: StorageObject): string {
    const ihostItem = item as IhostItem
    return ihostItem.url ?? ''
  },
}
