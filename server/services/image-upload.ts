import type { Storage as S3Storage } from '../../shared/types'
import type { Platform } from '../platform/interface'
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

// Minimal R2Bucket interface we actually call — typed locally so we don't
// depend on @cloudflare/workers-types on non-CF builds.
interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  delete(key: string): Promise<void>
}

type Backend =
  | { kind: 'r2'; bucket: R2BucketLike; publicUrlBase: string }
  | { kind: 's3'; storage: S3Storage }
  | { kind: 'none' }

// CF deployment with `PUBLIC_IMAGES` binding + `PUBLIC_IMAGES_URL` env var →
// writes via R2 binding (zero-auth, zero-egress), reads via R2's public
// domain (direct browser fetch, no Worker round-trip per image).
// Everything else → falls back to the user-configured `mode='public'` S3
// storage in the `storages` table.
async function getBackend(platform: Platform): Promise<Backend> {
  const r2 = platform.getBinding<R2BucketLike>('PUBLIC_IMAGES')
  const publicUrl = platform.getEnv('PUBLIC_IMAGES_URL')
  if (r2 && publicUrl) {
    return { kind: 'r2', bucket: r2, publicUrlBase: publicUrl.replace(/\/$/, '') }
  }
  try {
    const storage = (await selectStorage(platform.db, 'public')) as unknown as S3Storage
    return { kind: 's3', storage }
  } catch {
    return { kind: 'none' }
  }
}

/**
 * Stream-proxy a File to the workspace's public image backend and return the
 * permanent public URL. Shared by /api/me/avatar and /api/teams/:id/logo —
 * validates mime + size, selects backend (R2 binding on CF / S3 fallback),
 * constructs the key as `<prefix>/<id>.<ext>`, PUTs, returns URL.
 */
export async function uploadPublicImage(
  platform: Platform,
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

  const backend = await getBackend(platform)
  if (backend.kind === 'none') {
    return { ok: false, status: 503, error: 'No public storage configured' }
  }

  const key = imageKey(prefix, id, file.type)
  const bytes = new Uint8Array(await file.arrayBuffer())

  if (backend.kind === 'r2') {
    await backend.bucket.put(key, bytes, { httpMetadata: { contentType: file.type } })
    return { ok: true, url: `${backend.publicUrlBase}/${key}` }
  }

  await s3.putObject(backend.storage, key, bytes, file.type)
  return { ok: true, url: s3.getPublicUrl(backend.storage, key) }
}

/**
 * Best-effort delete of every mime variant of a public image. DB clearing is
 * the caller's responsibility — this only touches the backend object store.
 */
export async function deletePublicImageVariants(platform: Platform, prefix: string, id: string): Promise<void> {
  const backend = await getBackend(platform)
  if (backend.kind === 'none') return

  if (backend.kind === 'r2') {
    await Promise.allSettled(IMAGE_MIMES.map((mime) => backend.bucket.delete(imageKey(prefix, id, mime))))
    return
  }

  try {
    await Promise.allSettled(IMAGE_MIMES.map((mime) => s3.deleteObject(backend.storage, imageKey(prefix, id, mime))))
  } catch (err) {
    console.warn('[image-upload] S3 cleanup skipped:', err)
  }
}
