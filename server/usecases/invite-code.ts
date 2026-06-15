// The invite-codes resource usecase. Owns every business decision behind the
// /api/admin/invite-codes and /api/invite-codes routes — the expiry policy
// (days → absolute timestamp), the delete guards (unused-only), and activity
// logging — so the http handlers only validate input, call these functions, and
// serialize the result.

import type { ActivityRepo, InviteCodeRecord, InviteRepo } from './ports'

export type InviteCodeDeps = {
  invites: InviteRepo
  activity: ActivityRepo
}

export type DeleteInviteCodeOutcome = { ok: true } | { ok: false; reason: 'not_found' | 'already_used' }

export function listInviteCodes(
  deps: Pick<InviteCodeDeps, 'invites'>,
  params: { page: number; pageSize: number },
): Promise<{ items: InviteCodeRecord[]; total: number }> {
  return deps.invites.list(params.page, params.pageSize)
}

export function validateInviteCode(
  deps: Pick<InviteCodeDeps, 'invites'>,
  code: string,
): Promise<{ valid: boolean; error?: string }> {
  return deps.invites.validate(code)
}

export async function generateInviteCodes(
  deps: InviteCodeDeps,
  params: { userId: string; orgId: string; count: number; expiresInDays?: number },
): Promise<{ codes: InviteCodeRecord[] }> {
  const { userId, orgId, count, expiresInDays } = params
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : undefined
  const codes = await deps.invites.generate(userId, count, expiresAt)
  await deps.activity.record({
    orgId,
    userId,
    action: 'invite_code_generate',
    targetType: 'invite_code',
    targetName: `${codes.length} codes`,
    metadata: { count: codes.length, expiresInDays },
  })
  return { codes }
}

export async function deleteInviteCode(
  deps: InviteCodeDeps,
  params: { userId: string; orgId: string; id: string },
): Promise<DeleteInviteCodeOutcome> {
  const { userId, orgId, id } = params
  const result = await deps.invites.delete(id)
  if (result === 'not_found') return { ok: false, reason: 'not_found' }
  if (result === 'already_used') return { ok: false, reason: 'already_used' }
  await deps.activity.record({
    orgId,
    userId,
    action: 'invite_code_delete',
    targetType: 'invite_code',
    targetId: id,
    targetName: id,
  })
  return { ok: true }
}
