import type { Storage as S3Storage } from '../../shared/types'
import type { Database } from '../platform/interface'
import { S3Service } from './s3'
import { selectStorage } from './storage'

const s3 = new S3Service()

export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type ImageMime = (typeof IMAGE_MIMES)[number]
export const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MiB

const MIME_TO_EXT: Record<ImageMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function isImageMime(v: unknown): v is ImageMime {
  return typeof v === 'string' && (IMAGE_MIMES as readonly string[]).includes(v)
}

export function imageKey(prefix: string, id: string, mime: ImageMime): string {
  return `${prefix}/${id}.${MIME_TO_EXT[mime]}`
}

export type ImageUploadResult = { ok: true; url: string } | { ok: false; status: 400 | 413 | 503; error: string }

/**
 * Stream-proxy a File to the workspace's public-mode bucket and return the
 * permanent public URL. Shared by /api/me/avatar and /api/teams/:id/logo —
 * validates mime + size, selects public storage, constructs the S3 key as
 * `<prefix>/<id>.<ext>`, PUTs, returns URL.
 *
 * Caller is responsible for auth + writing the returned URL to the right
 * DB column (user.image / organization.logo).
 */
export async function uploadPublicImage(
  db: Database,
  prefix: string,
  id: string,
  file: File,
): Promise<ImageUploadResult> {
  if (!isImageMime(file.type)) {
    return { ok: false, status: 400, error: 'Only PNG, JPG, and WebP images are allowed' }
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return { ok: false, status: 413, error: 'File too large. Max 2 MiB.' }
  }

  let storage: S3Storage
  try {
    storage = (await selectStorage(db, 'public')) as unknown as S3Storage
  } catch {
    return { ok: false, status: 503, error: 'No public storage configured' }
  }

  const key = imageKey(prefix, id, file.type)
  const bytes = new Uint8Array(await file.arrayBuffer())
  await s3.putObject(storage, key, bytes, file.type)
  return { ok: true, url: s3.getPublicUrl(storage, key) }
}

/**
 * Best-effort delete of every mime variant of a public image. DB clearing
 * is the caller's responsibility — this only touches S3.
 */
export async function deletePublicImageVariants(db: Database, prefix: string, id: string): Promise<void> {
  try {
    const storage = (await selectStorage(db, 'public')) as unknown as S3Storage
    await Promise.allSettled(IMAGE_MIMES.map((mime) => s3.deleteObject(storage, imageKey(prefix, id, mime))))
  } catch (err) {
    console.warn('[image-upload] S3 cleanup skipped:', err)
  }
}
