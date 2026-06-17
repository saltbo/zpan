// The users resource usecase. Owns the front-of-house business decisions behind
// the surviving /api/users routes — the authenticated user's own avatar
// (PUT/DELETE /api/users/me/avatar), the read-only public profile lookup
// (GET /api/users/:username), and the admin personal-org storage-entitlement
// grants (with their activity logging) — so the http handlers only validate
// input, call these functions, and serialize the result.
//
// Admin user management (list / disable-enable / delete) is no longer served
// here: the frontend calls better-auth's /api/auth/admin/* endpoints directly.
//
// The deeper entitlement rules (admin-grant-only source guard, personal-org-
// not-found) live in the UserAdminRepo adapter and surface here as a
// UserOperationFailure ({ error, status }); these functions thread that failure
// outward unchanged so the http layer maps {status} directly.

import type { Platform } from '../platform/interface'
import type {
  ActivityRepo,
  EntitlementResult,
  ImageUpload,
  ProfileRepo,
  PublicUser,
  QuotaEntitlementItem,
  UserAdminRepo,
  UserOperationFailure,
} from './ports'

export type UserDeps = {
  userAdmin: UserAdminRepo
  activity: ActivityRepo
}

// Entitlement operations defer to the repo for the rule that may reject them;
// when it does it hands back a UserOperationFailure carrying the exact http
// status. The handler reads `failure` and re-serializes { error } with that status.
export type RepoFailure = { ok: false; failure: UserOperationFailure }

export type ListUserEntitlementsOutcome =
  | { ok: true; result: { orgId: string; items: QuotaEntitlementItem[] } }
  | RepoFailure

export type EntitlementOutcome = { ok: true; result: EntitlementResult } | RepoFailure

export function listUserEntitlements(
  deps: Pick<UserDeps, 'userAdmin'>,
  userId: string,
): Promise<ListUserEntitlementsOutcome> {
  return deps.userAdmin.listUserPersonalEntitlements(userId).then((result) => {
    if ('error' in result) return { ok: false, failure: result } as const
    return { ok: true, result } as const
  })
}

export async function grantUserEntitlement(
  deps: UserDeps,
  params: {
    adminUserId: string
    adminOrgId: string
    targetUserId: string
    resourceType: 'storage'
    bytes: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<EntitlementOutcome> {
  const { adminUserId, adminOrgId, targetUserId, resourceType, bytes, expiresAt, note } = params
  const result = await deps.userAdmin.grantUserPersonalEntitlement({
    adminUserId,
    targetUserId,
    resourceType,
    bytes,
    expiresAt,
    note,
  })
  if ('error' in result) return { ok: false, failure: result }
  await deps.activity.record({
    orgId: adminOrgId,
    userId: adminUserId,
    action: 'quota_entitlement_grant',
    targetType: 'quota',
    targetId: result.orgId,
    targetName: targetUserId,
    metadata: {
      targetUserId,
      entitlementId: result.entitlement.id,
      resourceType: result.entitlement.resourceType,
      bytes: result.entitlement.bytes,
      expiresAt: result.entitlement.expiresAt?.toISOString() ?? null,
    },
  })
  return { ok: true, result }
}

export async function updateUserEntitlement(
  deps: UserDeps,
  params: {
    adminUserId: string
    adminOrgId: string
    targetUserId: string
    entitlementId: string
    bytes?: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<EntitlementOutcome> {
  const { adminUserId, adminOrgId, targetUserId, entitlementId, bytes, expiresAt, note } = params
  const result = await deps.userAdmin.updateUserPersonalEntitlement({
    adminUserId,
    targetUserId,
    entitlementId,
    bytes,
    expiresAt,
    note,
  })
  if ('error' in result) return { ok: false, failure: result }
  await deps.activity.record({
    orgId: adminOrgId,
    userId: adminUserId,
    action: 'quota_entitlement_update',
    targetType: 'quota',
    targetId: result.orgId,
    targetName: targetUserId,
    metadata: {
      targetUserId,
      entitlementId: result.entitlement.id,
      bytes: result.entitlement.bytes,
      expiresAt: result.entitlement.expiresAt?.toISOString() ?? null,
    },
  })
  return { ok: true, result }
}

export async function revokeUserEntitlement(
  deps: UserDeps,
  params: { adminUserId: string; adminOrgId: string; targetUserId: string; entitlementId: string },
): Promise<EntitlementOutcome> {
  const { adminUserId, adminOrgId, targetUserId, entitlementId } = params
  const result = await deps.userAdmin.revokeUserPersonalEntitlement({ adminUserId, targetUserId, entitlementId })
  if ('error' in result) return { ok: false, failure: result }
  await deps.activity.record({
    orgId: adminOrgId,
    userId: adminUserId,
    action: 'quota_entitlement_revoke',
    targetType: 'quota',
    targetId: result.orgId,
    targetName: targetUserId,
    metadata: {
      targetUserId,
      entitlementId: result.entitlement.id,
      bytes: result.entitlement.bytes,
    },
  })
  return { ok: true, result }
}

// ── self: the authenticated user's own avatar ────────────────────────────────

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

// ── public: read-only profile lookup by username ─────────────────────────────

export function getPublicProfile(deps: { profiles: ProfileRepo }, username: string): Promise<PublicUser | null> {
  return deps.profiles.getUserByUsername(username)
}
