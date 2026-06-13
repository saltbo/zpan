import { mimeToExt } from '../../lib/mime-utils'
import type { Platform } from '../../platform/interface'
import type {
  ImageMime,
  ImageUpload,
  ImageUploadResult,
  S3Gateway,
  StorageRecord,
  StorageRepo,
} from '../../usecases/ports'
import { IMAGE_MIMES, MAX_IMAGE_SIZE } from '../../usecases/ports'

export function isImageMime(v: unknown): v is ImageMime {
  return typeof v === 'string' && (IMAGE_MIMES as readonly string[]).includes(v)
}

export function imageKey(prefix: string, id: string, mime: ImageMime): string {
  return `${prefix}/${id}.${mimeToExt(mime)}`
}

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
  | { kind: 's3'; storage: StorageRecord }
  | { kind: 'none' }

export function createImageUploadGateway(s3: S3Gateway, storages: StorageRepo): ImageUpload {
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
      const storage = await storages.select('public')
      return { kind: 's3', storage }
    } catch {
      return { kind: 'none' }
    }
  }

  return {
    async uploadPublicImage(platform, prefix, id, file): Promise<ImageUploadResult> {
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
    },

    // Best-effort delete of every mime variant of a public image. DB clearing is
    // the caller's responsibility — this only touches the backend object store.
    async deletePublicImageVariants(platform, prefix, id): Promise<void> {
      const backend = await getBackend(platform)
      if (backend.kind === 'none') return

      if (backend.kind === 'r2') {
        await Promise.allSettled(IMAGE_MIMES.map((mime) => backend.bucket.delete(imageKey(prefix, id, mime))))
        return
      }

      try {
        await Promise.allSettled(
          IMAGE_MIMES.map((mime) => s3.deleteObject(backend.storage, imageKey(prefix, id, mime))),
        )
      } catch (err) {
        console.warn('[image-upload] S3 cleanup skipped:', err)
      }
    },
  }
}
