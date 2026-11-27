import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { generateId, generateToken } from '../../../shared/ids'
import { user } from '../../db/auth-schema'
import { inviteCodes } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { InviteCodeListItem, InviteCodeRecord, InviteRepo } from '../../usecases/ports'
import { afterCreatedAtId, keysetPage } from './keyset'

export function createInviteRepo(db: Database): InviteRepo {
  return {
    async generate(adminUserId, quantity, expiresAt) {
      const now = new Date()
      const rows: InviteCodeRecord[] = Array.from({ length: quantity }, () => ({
        id: generateId(),
        code: generateToken(10),
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

    async list({ pageSize, after }) {
      const rows = await db
        .select({ code: inviteCodes, redeemerName: user.name, redeemerEmail: user.email })
        .from(inviteCodes)
        .leftJoin(user, eq(user.id, inviteCodes.usedBy))
        .where(afterCreatedAtId(inviteCodes.createdAt, inviteCodes.id, after))
        .orderBy(desc(inviteCodes.createdAt), desc(inviteCodes.id))
        .limit(pageSize + 1)
      const page = keysetPage(rows, pageSize, (row) => ({ createdAt: row.code.createdAt, id: row.code.id }))
      const items = page.rows.map(({ code, redeemerName, redeemerEmail }): InviteCodeListItem => {
        if (redeemerName === null || redeemerEmail === null) return code
        return { ...code, usedByUser: { name: redeemerName, email: redeemerEmail } }
      })
      return { items, nextBoundary: page.next }
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
