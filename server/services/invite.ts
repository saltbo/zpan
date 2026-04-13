import { and, count, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { customAlphabet, nanoid } from 'nanoid'
import { inviteCodes } from '../db/schema'
import type { Database } from '../platform/interface'

export type InviteCode = typeof inviteCodes.$inferSelect

const generateCode = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8)

export async function generateInviteCodes(
  db: Database,
  adminUserId: string,
  quantity: number,
  expiresAt?: Date,
): Promise<InviteCode[]> {
  const now = new Date()
  const rows: InviteCode[] = Array.from({ length: quantity }, () => ({
    id: nanoid(),
    code: generateCode(),
    createdBy: adminUserId,
    usedBy: null,
    usedAt: null,
    expiresAt: expiresAt ?? null,
    createdAt: now,
  }))
  await db.insert(inviteCodes).values(rows)
  return rows
}

export async function validateInviteCode(db: Database, code: string): Promise<{ valid: boolean; error?: string }> {
  const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code))
  const row = rows[0]
  if (!row) return { valid: false, error: 'Invalid invite code' }
  if (row.usedBy) return { valid: false, error: 'Invite code already used' }
  if (row.expiresAt && row.expiresAt < new Date()) return { valid: false, error: 'Invite code expired' }
  return { valid: true }
}

export async function redeemInviteCode(
  db: Database,
  code: string,
  userId: string,
): Promise<'ok' | 'not_found' | 'already_used' | 'expired'> {
  const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code))
  const row = rows[0]
  if (!row) return 'not_found'
  if (row.usedBy) return 'already_used'
  if (row.expiresAt && row.expiresAt < new Date()) return 'expired'

  const result = await db
    .update(inviteCodes)
    .set({ usedBy: userId, usedAt: new Date() })
    .where(
      and(
        eq(inviteCodes.code, code),
        isNull(inviteCodes.usedBy),
        or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
      ),
    )

  // If no rows affected, another request redeemed it concurrently
  const changes = (result as { rowsAffected?: number }).rowsAffected ?? (result as { changes?: number }).changes
  if (changes === undefined)
    throw new Error('DB driver returned no rowsAffected — cannot confirm invite code redemption')
  return changes > 0 ? 'ok' : 'already_used'
}

export async function listInviteCodes(
  db: Database,
  page: number,
  pageSize: number,
): Promise<{ items: InviteCode[]; total: number }> {
  const [totalResult, items] = await Promise.all([
    db.select({ count: count() }).from(inviteCodes),
    db
      .select()
      .from(inviteCodes)
      .orderBy(desc(inviteCodes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])
  return { items, total: totalResult[0]?.count ?? 0 }
}

export async function deleteInviteCode(db: Database, codeId: string): Promise<'ok' | 'not_found' | 'already_used'> {
  const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.id, codeId))
  const row = rows[0]
  if (!row) return 'not_found'
  if (row.usedBy) return 'already_used'
  await db.delete(inviteCodes).where(eq(inviteCodes.id, codeId))
  return 'ok'
}
