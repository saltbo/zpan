import {
  AVATAR_CONTENT_TYPES,
  type AvatarContentType,
  type AvatarScope,
  avatarUploadResponseSchema,
  deleteAvatar,
  MAX_AVATAR_BYTES,
  uploadAvatar,
} from 'zpan-cloud-sdk'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../../shared/constants'
import { type Platform, PUBLIC_IMAGES_BINDING, type R2BucketLike } from '../../platform/interface'
import {
  AVATAR_PREFIX,
  type ImageUpload,
  type ImageUploadResult,
  type LicenseBindingRepo,
  type LicensingCloudGateway,
  LOGO_PREFIX,
} from '../../usecases/ports'

export function isAvatarContentType(v: unknown): v is AvatarContentType {
  return typeof v === 'string' && (AVATAR_CONTENT_TYPES as readonly string[]).includes(v)
}

// Only the avatar + org-logo usecases call this port, and they pass these exact
// prefixes — an unknown prefix is a programming error, so fail fast.
function prefixToScope(prefix: string): AvatarScope {
  if (prefix === AVATAR_PREFIX) return 'user'
  if (prefix === LOGO_PREFIX) return 'team'
  throw new Error(`Unknown image prefix: ${prefix}`)
}

// The stable R2 object key: scope + entity id, no extension (the content type rides in
// R2 metadata, so one key serves any image format). One key per entity → re-uploads
// overwrite in place; the `?v=` cache-buster on the URL forces browsers to refetch.
function avatarKey(scope: AvatarScope, id: string): string {
  return `${scope}/${id}`
}

async function contentVersion(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest).slice(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Public URL for an R2-hosted avatar. With PUBLIC_IMAGES_URL set (an R2 custom domain)
// the browser hits R2 directly (no Worker egress); otherwise it goes through this
// instance's own /api/avatar-blobs serve route (works in local miniflare too, where R2
// has no public URL). A relative URL resolves against the instance origin.
function r2AvatarUrl(platform: Platform, key: string, version: string): string {
  const base = platform.getEnv('PUBLIC_IMAGES_URL')?.replace(/\/$/, '')
  return base ? `${base}/${key}?v=${version}` : `/api/avatar-blobs/${key}?v=${version}`
}

function cloudErrorCode(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('error' in data)) return null
  const error = (data as { error: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return null
}

// Maps a non-2xx Cloud avatar response to the local outcome status. Cloud error
// codes: unsupported_media_type → 400, payload_too_large → 413,
// license_inactive → 403, everything else (incl. malformed) → 500.
async function cloudUploadError(res: {
  status: number
  json(): Promise<unknown>
}): Promise<Extract<ImageUploadResult, { ok: false }>> {
  const code = cloudErrorCode(await res.json().catch(() => null))
  switch (code) {
    case 'unsupported_media_type':
      return { ok: false, status: 400, error: 'unsupported_media_type' }
    case 'payload_too_large':
      return { ok: false, status: 413, error: 'payload_too_large' }
    case 'license_inactive':
      return { ok: false, status: 403, error: 'license_inactive' }
    default:
      return { ok: false, status: 500, error: code ?? `cloud_request_failed_${res.status}` }
  }
}

// Host user avatars + team logos. On Cloudflare with a `PUBLIC_IMAGES` R2 binding, uploads go
// straight to that bucket and are served from this instance (or an R2 custom domain).
// Without the binding (Node/Docker, or a Worker without it) it falls back to the ZPan
// Cloud avatar service, which requires an active license binding — an unbound instance
// then returns `cloud_required` (503) and delete is a best-effort no-op.
export function createImageUploadGateway(
  licenseBinding: LicenseBindingRepo,
  licensingCloud: LicensingCloudGateway,
): ImageUpload {
  function cloudBaseUrl(platform: Platform): string {
    return platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
  }

  async function r2Upload(
    bucket: R2BucketLike,
    platform: Platform,
    scope: AvatarScope,
    id: string,
    file: File,
    contentType: string,
  ): Promise<ImageUploadResult> {
    const buffer = await file.arrayBuffer()
    const key = avatarKey(scope, id)
    await bucket.put(key, buffer, { httpMetadata: { contentType } })
    return { ok: true, url: r2AvatarUrl(platform, key, await contentVersion(buffer)) }
  }

  async function cloudUpload(
    platform: Platform,
    scope: AvatarScope,
    id: string,
    file: File,
    contentType: AvatarContentType,
  ): Promise<ImageUploadResult> {
    const binding = await licenseBinding.loadActiveLicenseBinding()
    if (!binding?.refreshToken) return { ok: false, status: 503, error: 'cloud_required' }

    const client = licensingCloud.createAvatarUploadClient(cloudBaseUrl(platform), binding.refreshToken)
    try {
      const res = await uploadAvatar(client, { scope, id, body: file, contentType })
      if (!res.ok) return cloudUploadError(res)
      const parsed = avatarUploadResponseSchema.safeParse(await res.json())
      if (!parsed.success) return { ok: false, status: 500, error: 'invalid_cloud_response' }
      return { ok: true, url: parsed.data.url }
    } catch {
      return { ok: false, status: 500, error: 'cloud_request_failed' }
    }
  }

  return {
    async uploadPublicImage(platform, prefix, id, file): Promise<ImageUploadResult> {
      const contentType = file.type
      if (!isAvatarContentType(contentType)) {
        return { ok: false, status: 400, error: 'Only PNG, JPG, WebP, and GIF images are allowed' }
      }
      if (file.size > MAX_AVATAR_BYTES) {
        return { ok: false, status: 413, error: 'File too large. Max 1 MiB.' }
      }

      const scope = prefixToScope(prefix)
      const bucket = platform.getBinding<R2BucketLike>(PUBLIC_IMAGES_BINDING)
      if (bucket) return r2Upload(bucket, platform, scope, id, file, contentType)
      return cloudUpload(platform, scope, id, file, contentType)
    },

    // Best-effort delete of the hosted image. DB clearing is the caller's responsibility —
    // this only removes the object from R2 (CF) or the Cloud avatar service (fallback).
    async deletePublicImageVariants(platform, prefix, id): Promise<void> {
      const scope = prefixToScope(prefix)

      const bucket = platform.getBinding<R2BucketLike>(PUBLIC_IMAGES_BINDING)
      if (bucket) {
        try {
          await bucket.delete(avatarKey(scope, id))
        } catch (err) {
          console.warn('[image-upload] r2 avatar delete skipped:', err)
        }
        return
      }

      const binding = await licenseBinding.loadActiveLicenseBinding()
      if (!binding?.refreshToken) return
      const client = licensingCloud.createAvatarUploadClient(cloudBaseUrl(platform), binding.refreshToken)
      try {
        await deleteAvatar(client, { scope, id })
      } catch (err) {
        console.warn('[image-upload] cloud avatar delete skipped:', err)
      }
    },
  }
}
