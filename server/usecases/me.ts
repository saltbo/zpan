// The `me` resource usecase — avatar mutations scoped to the currently
// authenticated user (PUT/DELETE /api/me/avatar). Owns the order of operations
// (upload→persist, clear-DB→best-effort-cleanup) and surfaces the image
// gateway's failure as an outcome the http layer maps to a status.
//
// The multipart parsing and File extraction stay in the handler (http
// concerns); this usecase receives the already-extracted File.
//
// Not to be confused with profile.ts, which is the read-only public lookup
// (/api/profiles/:username).

import type { Platform } from '../platform/interface'
import type { ImageUpload, ProfileRepo } from './ports'

const AVATAR_PREFIX = '_system/avatars'

export type AvatarDeps = {
  imageUpload: ImageUpload
  profiles: ProfileRepo
}

// The image gateway can reject with a status (400 bad mime, 413 too large, 503
// no public storage). The http layer turns this into the error body + status;
// the decision of *which* status lives in the gateway, surfaced verbatim here.
export type UpdateAvatarOutcome = { ok: true; url: string } | { ok: false; status: 400 | 413 | 503; error: string }

// `platform` is a request-bound capability (R2 binding + public-URL env are
// request-scoped), so it is a plain function param — not stored on AvatarDeps.
export async function updateAvatar(
  deps: AvatarDeps,
  params: { platform: Platform; userId: string; file: File },
): Promise<UpdateAvatarOutcome> {
  const { platform, userId, file } = params
  const result = await deps.imageUpload.uploadPublicImage(platform, AVATAR_PREFIX, userId, file)
  if (!result.ok) return result
  await deps.profiles.setAvatar(userId, result.url)
  return { ok: true, url: result.url }
}

export async function removeAvatar(deps: AvatarDeps, params: { platform: Platform; userId: string }): Promise<void> {
  const { platform, userId } = params
  // Clear DB first (authoritative); storage cleanup below is best-effort.
  await deps.profiles.setAvatar(userId, null)
  await deps.imageUpload.deletePublicImageVariants(platform, AVATAR_PREFIX, userId)
}
