import { and, count, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { customAlphabet, nanoid } from 'nanoid'
import { inviteCodes } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { InviteCodeRecord, InviteRepo } from '../../usecases/ports'

const generateCode = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8)

export function createInviteRepo(db: Database): InviteRepo {
  return {
    async generate(adminUserId, quantity, expiresAt) {
      const now = new Date()
      const rows: InviteCodeRecord[] = Array.from({ length: quantity }, () => ({
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
    },

    async validate(code) {
      const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code))
      const row = rows[0]
      if (!row) return { valid: false, error: 'Invalid invite code' }
      if (row.usedBy) return { valid: false, error: 'Invite code already used' }
      if (row.expiresAt && row.expiresAt < new Date()) return { valid: false, error: 'Invite code expired' }
      return { valid: true }
    },

    async redeem(code, userId) {
      const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code))
      const row = rows[0]
      if (!row) return 'not_found'
      if (row.usedBy) return 'already_used'
      if (row.expiresAt && row.expiresAt < new Date()) return 'expired'

      const updated = await db
        .update(inviteCodes)
        .set({ usedBy: userId, usedAt: new Date() })
        .where(
          and(
            eq(inviteCodes.code, code),
            isNull(inviteCodes.usedBy),
            or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
          ),
        )
        .returning({ id: inviteCodes.id })

      return updated.length > 0 ? 'ok' : 'already_used'
    },

    async list(page, pageSize) {
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
    },

    async delete(codeId) {
      const rows = await db.select().from(inviteCodes).where(eq(inviteCodes.id, codeId))
      const row = rows[0]
      if (!row) return 'not_found'
      if (row.usedBy) return 'already_used'
      await db.delete(inviteCodes).where(eq(inviteCodes.id, codeId))
      return 'ok'
    },
  }
}
