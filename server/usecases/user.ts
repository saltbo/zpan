// The admin users resource usecase. Owns every business decision behind the
// /api/admin/users routes — user listing/lookup, status (disable/enable) and
// delete (single + batch), and the personal-org storage-entitlement grants — plus
// the activity logging that accompanies the mutating operations, so the http
// handlers only validate input, call these functions, and serialize the result.
//
// The deeper rules (last-admin / self-protection, missing-user-in-batch,
// admin-grant-only source guard, personal-org-not-found) live in the
// UserAdminRepo adapter and surface here as a UserOperationFailure ({ error,
// status }); these functions thread that failure outward unchanged so the http
// layer maps {status} directly. The boolean-returning setUserStatus/deleteUser
// instead signal absence, which becomes a flat `not_found`.

import type {
  ActivityRepo,
  EntitlementResult,
  QuotaEntitlementItem,
  UserAdminRepo,
  UserOperationFailure,
  UserWithOrg,
} from './ports'

export type UserDeps = {
  userAdmin: UserAdminRepo
  activity: ActivityRepo
}

// Most operations defer to the repo for the rule that may reject them; when it
// does it hands back a UserOperationFailure carrying the exact http status. The
// handler reads `failure` and re-serializes { error } with that status.
export type RepoFailure = { ok: false; failure: UserOperationFailure }

export type GetUserOutcome = { ok: true; user: UserWithOrg } | RepoFailure

export type SetUsersStatusOutcome =
  | { ok: true; result: { updated: number; ids: string[] }; status: 'active' | 'disabled' }
  | RepoFailure

export type DeleteUsersOutcome = { ok: true; result: { deleted: number; ids: string[] } } | RepoFailure

export type ListUserEntitlementsOutcome =
  | { ok: true; result: { orgId: string; items: QuotaEntitlementItem[] } }
  | RepoFailure

export type EntitlementOutcome = { ok: true; result: EntitlementResult } | RepoFailure

// setUserStatus/deleteUser report success/absence with a boolean rather than a
// UserOperationFailure, so their single-user outcomes collapse to a flat 404.
export type SetUserStatusOutcome = { ok: true } | { ok: false; reason: 'not_found' }

export type DeleteUserOutcome = { ok: true } | { ok: false; reason: 'not_found' }

export function listUsers(
  deps: Pick<UserDeps, 'userAdmin'>,
  params: { page: number; pageSize: number; search?: string },
): Promise<{ items: UserWithOrg[]; total: number }> {
  return deps.userAdmin.listUsers(params.page, params.pageSize, params.search)
}

export async function getUser(deps: Pick<UserDeps, 'userAdmin'>, userId: string): Promise<GetUserOutcome> {
  const result = await deps.userAdmin.getUser(userId)
  if ('error' in result) return { ok: false, failure: result }
  return { ok: true, user: result }
}

export async function setUsersStatus(
  deps: UserDeps,
  params: { adminUserId: string; orgId: string; ids: string[]; status: 'active' | 'disabled' },
): Promise<SetUsersStatusOutcome> {
  const { adminUserId, orgId, ids, status } = params
  const result = await deps.userAdmin.setUsersStatus(ids, status)
  if ('error' in result) return { ok: false, failure: result }
  await deps.activity.record({
    orgId,
    userId: adminUserId,
    action: status === 'disabled' ? 'user_disable' : 'user_enable',
    targetType: 'user',
    targetName: 'batch',
    metadata: { ...result, status },
  })
  return { ok: true, result, status }
}

export async function deleteUsers(
  deps: UserDeps,
  params: { adminUserId: string; orgId: string; ids: string[] },
): Promise<DeleteUsersOutcome> {
  const { adminUserId, orgId, ids } = params
  const result = await deps.userAdmin.deleteUsers(ids)
  if ('error' in result) return { ok: false, failure: result }
  await deps.activity.record({
    orgId,
    userId: adminUserId,
    action: 'user_delete',
    targetType: 'user',
    targetName: 'batch',
    metadata: result,
  })
  return { ok: true, result }
}

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

export async function setUserStatus(
  deps: UserDeps,
  params: { adminUserId: string; orgId: string; userId: string; status: 'active' | 'disabled' },
): Promise<SetUserStatusOutcome> {
  const { adminUserId, orgId, userId, status } = params
  const updated = await deps.userAdmin.setUserStatus(userId, status)
  if (!updated) return { ok: false, reason: 'not_found' }
  await deps.activity.record({
    orgId,
    userId: adminUserId,
    action: status === 'disabled' ? 'user_disable' : 'user_enable',
    targetType: 'user',
    targetId: userId,
    targetName: userId,
    metadata: { status },
  })
  return { ok: true }
}

export async function deleteUser(
  deps: UserDeps,
  params: { adminUserId: string; orgId: string; userId: string },
): Promise<DeleteUserOutcome> {
  const { adminUserId, orgId, userId } = params
  const deleted = await deps.userAdmin.deleteUser(userId)
  if (!deleted) return { ok: false, reason: 'not_found' }
  await deps.activity.record({
    orgId,
    userId: adminUserId,
    action: 'user_delete',
    targetType: 'user',
    targetId: userId,
    targetName: userId,
  })
  return { ok: true }
}
