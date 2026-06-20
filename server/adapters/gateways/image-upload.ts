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
import type { Platform } from '../../platform/interface'
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

// Host user avatars + team logos on the ZPan Cloud avatar service. Requires the
// instance to be paired to Cloud (an active license binding with a refresh token);
// an unbound instance can't host images, so upload returns `cloud_required` (503)
// and delete is a best-effort no-op. Never throws on the unbound path.
export function createImageUploadGateway(
  licenseBinding: LicenseBindingRepo,
  licensingCloud: LicensingCloudGateway,
): ImageUpload {
  function cloudBaseUrl(platform: Platform): string {
    return platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
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

      const binding = await licenseBinding.loadActiveLicenseBinding()
      if (!binding?.refreshToken) return { ok: false, status: 503, error: 'cloud_required' }

      const client = licensingCloud.createAvatarUploadClient(cloudBaseUrl(platform), binding.refreshToken)
      try {
        const res = await uploadAvatar(client, { scope: prefixToScope(prefix), id, body: file, contentType })
        if (!res.ok) return cloudUploadError(res)
        const parsed = avatarUploadResponseSchema.safeParse(await res.json())
        if (!parsed.success) return { ok: false, status: 500, error: 'invalid_cloud_response' }
        return { ok: true, url: parsed.data.url }
      } catch {
        return { ok: false, status: 500, error: 'cloud_request_failed' }
      }
    },

    // Best-effort delete of the Cloud-hosted image. DB clearing is the caller's
    // responsibility — this only removes the object from the Cloud avatar service.
    // An unbound instance has nothing to delete, so it is a silent no-op.
    async deletePublicImageVariants(platform, prefix, id): Promise<void> {
      const binding = await licenseBinding.loadActiveLicenseBinding()
      if (!binding?.refreshToken) return

      const client = licensingCloud.createAvatarUploadClient(cloudBaseUrl(platform), binding.refreshToken)
      try {
        await deleteAvatar(client, { scope: prefixToScope(prefix), id })
      } catch (err) {
        console.warn('[image-upload] cloud avatar delete skipped:', err)
      }
    },
  }
}
