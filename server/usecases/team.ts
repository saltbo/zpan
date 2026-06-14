// The team resource usecase. Owns every business decision behind both team
// surfaces — the user-facing /api/teams routes (invite links, joining, the
// activity feed, the org logo) and the admin /api/admin/teams routes (team
// listing/detail and per-team quota entitlements) — plus the activity logging
// that accompanies the mutating operations, so the http handlers only validate
// input, call these functions, and serialize the result.
//
// Owner/admin/member role checks and the personal-org public-read carve-out for
// the activity feed live here; the http layer maps each outcome to its status.
//
// Two failure shapes appear, mirroring the ports:
//   - The user-facing flows reject with a literal `reason` (forbidden,
//     invite_invalid/expired/already_member, image_upload).
//   - The admin entitlement flows defer to UserAdminRepo, which hands back a
//     UserOperationFailure ({ error, status }); those outcomes thread that
//     failure outward unchanged so the http layer maps {status} directly.

import type { Platform } from '../platform/interface'
import type {
  ActivityEventWithUser,
  ActivityRepo,
  EntitlementResult,
  ImageUpload,
  ImageUploadResult,
  InviteLinkInfo,
  OrgRepo,
  PendingInvitation,
  QuotaEntitlementItem,
  TeamInviteRepo,
  TeamRepo,
  TeamSummary,
  UserAdminRepo,
  UserOperationFailure,
} from './ports'

const LOGO_PREFIX = '_system/org-logos'

export type TeamDeps = {
  teams: TeamRepo
  teamInvites: TeamInviteRepo
  org: OrgRepo
  activity: ActivityRepo
  imageUpload: ImageUpload
  userAdmin: UserAdminRepo
}

// Admin entitlement operations defer to the repo for the rule that may reject
// them; when it does it hands back a UserOperationFailure carrying the exact http
// status. The handler reads `failure` and re-serializes { error } with that status.
export type RepoFailure = { ok: false; failure: UserOperationFailure }

// ─── User-facing: invite links ───────────────────────────────────────────────

export function getInviteLinkInfo(deps: Pick<TeamDeps, 'teamInvites'>, token: string): Promise<InviteLinkInfo | null> {
  return deps.teamInvites.getInviteLinkInfo(token)
}

export type CreateInviteLinkOutcome = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: 'forbidden' }

export async function createInviteLink(
  deps: Pick<TeamDeps, 'teamInvites' | 'org' | 'activity'>,
  params: { teamId: string; userId: string; role: 'editor' | 'viewer'; expiresIn?: number },
): Promise<CreateInviteLinkOutcome> {
  const { teamId, userId, role, expiresIn } = params
  const memberRole = await deps.org.getMemberRole(teamId, userId)
  if (memberRole !== 'owner') return { ok: false, reason: 'forbidden' }

  const link = await deps.teamInvites.createInviteLink(teamId, userId, role, expiresIn)
  await deps.activity.record({
    orgId: teamId,
    userId,
    action: 'team_invite_link_create',
    targetType: 'team',
    targetId: teamId,
    targetName: teamId,
    metadata: { role, expiresIn },
  })
  return { ok: true, token: link.token, expiresAt: link.expiresAt }
}

export type ListInvitationsOutcome = { ok: true; invitations: PendingInvitation[] } | { ok: false; reason: 'forbidden' }

export async function listInvitations(
  deps: Pick<TeamDeps, 'teamInvites' | 'org'>,
  params: { teamId: string; userId: string },
): Promise<ListInvitationsOutcome> {
  const memberRole = await deps.org.getMemberRole(params.teamId, params.userId)
  if (memberRole !== 'owner') return { ok: false, reason: 'forbidden' }
  const invitations = await deps.teamInvites.listPendingInvitations(params.teamId)
  return { ok: true, invitations }
}

// ─── User-facing: joining a team ─────────────────────────────────────────────

export type JoinTeamOutcome = { ok: true } | { ok: false; reason: 'invalid' | 'expired' | 'already_member' }

export async function joinTeam(
  deps: Pick<TeamDeps, 'teamInvites' | 'activity'>,
  params: { teamId: string; userId: string; token: string },
): Promise<JoinTeamOutcome> {
  const { teamId, userId, token } = params
  const result = await deps.teamInvites.acceptInviteLink(token, userId)
  if (result !== 'ok') return { ok: false, reason: result }

  await deps.activity.record({
    orgId: teamId,
    userId,
    action: 'team_member_join',
    targetType: 'team',
    targetId: teamId,
    targetName: teamId,
  })
  return { ok: true }
}

// ─── User-facing: activity feed ──────────────────────────────────────────────

// Access rule: a member of any role may read; in addition, every authenticated
// user may read a *personal* org's feed (personal orgs are public to auth users).
// A non-member of a non-personal org is forbidden.
export type ListActivityOutcome =
  | { ok: true; result: { items: ActivityEventWithUser[]; total: number } }
  | { ok: false; reason: 'forbidden' }

export async function listActivity(
  deps: Pick<TeamDeps, 'org' | 'activity'>,
  params: { teamId: string; userId: string; page: number; pageSize: number },
): Promise<ListActivityOutcome> {
  const { teamId, userId, page, pageSize } = params
  const role = await deps.org.getMemberRole(teamId, userId)
  if (role === null && !(await deps.org.isPersonalOrg(teamId))) {
    return { ok: false, reason: 'forbidden' }
  }
  const result = await deps.activity.list(teamId, { page, pageSize })
  return { ok: true, result }
}

// ─── User-facing: org logo ───────────────────────────────────────────────────

// Logo writes require owner or admin. The MIME/size validation (and the
// no-public-storage case) is owned by imageUpload, which returns
// { ok:false, status } for the 400/413/503 outcomes; setTeamLogo threads that
// status outward unchanged. A failed role check is the only 403 it raises itself.
export type SetTeamLogoOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: 'forbidden' }
  | { ok: false; reason: 'upload_failed'; status: 400 | 413 | 503; error: string }

export async function setTeamLogo(
  deps: Pick<TeamDeps, 'org' | 'teams' | 'imageUpload' | 'activity'>,
  params: { platform: Platform; teamId: string; userId: string; file: File },
): Promise<SetTeamLogoOutcome> {
  const { platform, teamId, userId, file } = params
  const role = await deps.org.getMemberRole(teamId, userId)
  if (role !== 'owner' && role !== 'admin') return { ok: false, reason: 'forbidden' }

  const result: ImageUploadResult = await deps.imageUpload.uploadPublicImage(platform, LOGO_PREFIX, teamId, file)
  if (!result.ok) return { ok: false, reason: 'upload_failed', status: result.status, error: result.error }

  await deps.teams.setLogo(teamId, result.url)
  await deps.activity.record({
    orgId: teamId,
    userId,
    action: 'team_logo_update',
    targetType: 'team',
    targetId: teamId,
    targetName: teamId,
  })
  return { ok: true, url: result.url }
}

export type DeleteTeamLogoOutcome = { ok: true } | { ok: false; reason: 'forbidden' }

export async function deleteTeamLogo(
  deps: Pick<TeamDeps, 'org' | 'teams' | 'imageUpload' | 'activity'>,
  params: { platform: Platform; teamId: string; userId: string },
): Promise<DeleteTeamLogoOutcome> {
  const { platform, teamId, userId } = params
  const role = await deps.org.getMemberRole(teamId, userId)
  if (role !== 'owner' && role !== 'admin') return { ok: false, reason: 'forbidden' }

  await deps.teams.setLogo(teamId, null)
  await deps.imageUpload.deletePublicImageVariants(platform, LOGO_PREFIX, teamId)
  await deps.activity.record({
    orgId: teamId,
    userId,
    action: 'team_logo_delete',
    targetType: 'team',
    targetId: teamId,
    targetName: teamId,
  })
  return { ok: true }
}

// ─── Admin: team listing / detail ────────────────────────────────────────────

export function listTeams(deps: Pick<TeamDeps, 'teams'>): Promise<{ items: TeamSummary[]; total: number }> {
  return deps.teams.listTeams().then((items) => ({ items, total: items.length }))
}

export function getTeam(deps: Pick<TeamDeps, 'teams'>, orgId: string): Promise<TeamSummary | null> {
  return deps.teams.getTeam(orgId)
}

// ─── Admin: per-team quota entitlements ──────────────────────────────────────

export type ListTeamEntitlementsOutcome =
  | { ok: true; result: { orgId: string; items: QuotaEntitlementItem[] } }
  | RepoFailure

export async function listTeamEntitlements(
  deps: Pick<TeamDeps, 'userAdmin'>,
  orgId: string,
): Promise<ListTeamEntitlementsOutcome> {
  const result = await deps.userAdmin.listOrgEntitlements(orgId)
  if ('error' in result) return { ok: false, failure: result }
  return { ok: true, result }
}

export type TeamEntitlementOutcome = { ok: true; result: EntitlementResult } | RepoFailure

export async function grantTeamEntitlement(
  deps: Pick<TeamDeps, 'userAdmin' | 'activity'>,
  params: {
    adminUserId: string
    adminOrgId: string
    targetOrgId: string
    resourceType: 'storage'
    bytes: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<TeamEntitlementOutcome> {
  const { adminUserId, adminOrgId, targetOrgId, resourceType, bytes, expiresAt, note } = params
  const result = await deps.userAdmin.grantOrgEntitlement({
    adminUserId,
    orgId: targetOrgId,
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
    targetId: targetOrgId,
    targetName: targetOrgId,
    metadata: {
      targetOrgId,
      entitlementId: result.entitlement.id,
      resourceType: result.entitlement.resourceType,
      bytes: result.entitlement.bytes,
      expiresAt: result.entitlement.expiresAt?.toISOString() ?? null,
    },
  })
  return { ok: true, result }
}

export async function updateTeamEntitlement(
  deps: Pick<TeamDeps, 'userAdmin' | 'activity'>,
  params: {
    adminUserId: string
    adminOrgId: string
    targetOrgId: string
    entitlementId: string
    bytes?: number
    expiresAt?: Date | null
    note?: string | null
  },
): Promise<TeamEntitlementOutcome> {
  const { adminUserId, adminOrgId, targetOrgId, entitlementId, bytes, expiresAt, note } = params
  const result = await deps.userAdmin.updateOrgEntitlement({
    adminUserId,
    orgId: targetOrgId,
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
    targetId: targetOrgId,
    targetName: targetOrgId,
    metadata: {
      targetOrgId,
      entitlementId: result.entitlement.id,
      bytes: result.entitlement.bytes,
      expiresAt: result.entitlement.expiresAt?.toISOString() ?? null,
    },
  })
  return { ok: true, result }
}

export async function revokeTeamEntitlement(
  deps: Pick<TeamDeps, 'userAdmin' | 'activity'>,
  params: { adminUserId: string; adminOrgId: string; targetOrgId: string; entitlementId: string },
): Promise<TeamEntitlementOutcome> {
  const { adminUserId, adminOrgId, targetOrgId, entitlementId } = params
  const result = await deps.userAdmin.revokeOrgEntitlement({ adminUserId, orgId: targetOrgId, entitlementId })
  if ('error' in result) return { ok: false, failure: result }

  await deps.activity.record({
    orgId: adminOrgId,
    userId: adminUserId,
    action: 'quota_entitlement_revoke',
    targetType: 'quota',
    targetId: targetOrgId,
    targetName: targetOrgId,
    metadata: {
      targetOrgId,
      entitlementId: result.entitlement.id,
      bytes: result.entitlement.bytes,
    },
  })
  return { ok: true, result }
}
