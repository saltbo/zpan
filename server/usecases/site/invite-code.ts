// The invite-codes resource usecase. Owns every business decision behind the
// /api/admin/invite-codes and /api/site/invite-codes routes — the expiry policy
// (days → absolute timestamp), the delete guards (unused-only), and activity
// logging — so the http handlers only validate input, call these functions, and
// serialize the result.

import { type AppError, badRequest, type InviteCodeRecord, type InviteRepo, notFound } from '../ports'

export type InviteCodeDeps = {
  invites: InviteRepo
}

export type DeleteInviteCodeOutcome = { ok: true } | { ok: false; error: AppError }

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
  params: { userId: string; count: number; expiresInDays?: number },
): Promise<{ codes: InviteCodeRecord[] }> {
  const { userId, count, expiresInDays } = params
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : undefined
  const codes = await deps.invites.generate(userId, count, expiresAt)
  return { codes }
}

export async function deleteInviteCode(deps: InviteCodeDeps, params: { id: string }): Promise<DeleteInviteCodeOutcome> {
  const { id } = params
  const result = await deps.invites.delete(id)
  if (result === 'not_found') return { ok: false, error: notFound('Invite code not found') }
  if (result === 'already_used') return { ok: false, error: badRequest('Cannot delete a used invite code') }
  return { ok: true }
}
