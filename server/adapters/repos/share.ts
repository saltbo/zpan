import { DirType } from '@shared/constants'
import type { CreateShareInput } from '@shared/schemas/share'
import { and, count, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { user } from '../../db/auth-schema'
import { matters, shareRecipients, shares } from '../../db/schema'
import { type AtomicQuery, executeWriteTransaction } from '../../db/transaction'
import { hashPassword } from '../../lib/password'
import type { Database } from '../../platform/interface'
import {
  CreateShareError,
  type Matter,
  type ShareListItem,
  type ShareRecord,
  type ShareRepo,
  type ShareResolution,
} from '../../usecases/ports'
import { createQuotaRepo } from './quota'

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

// Escape LIKE wildcards so user-controlled folder names don't act as patterns.
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

export function createShareRepo(db: Database): ShareRepo {
  const quota = createQuotaRepo(db)

  return {
    async create(input: CreateShareInput): Promise<ShareRecord> {
      if (input.kind === 'direct' && input.password) throw new CreateShareError('DIRECT_NO_PASSWORD')
      if (input.kind === 'direct' && input.recipients && input.recipients.length > 0)
        throw new CreateShareError('DIRECT_NO_RECIPIENTS')

      const matter = await db
        .select()
        .from(matters)
        .where(and(eq(matters.id, input.matterId), eq(matters.orgId, input.orgId)))
        .then((rows) => rows[0] ?? null)

      if (!matter) throw new CreateShareError('MATTER_NOT_FOUND')
      if (input.kind === 'direct' && matter.dirtype !== DirType.FILE) throw new CreateShareError('DIRECT_NO_FOLDER')

      const now = new Date()
      const token = input.kind === 'direct' ? `ds_${nanoid(10)}` : nanoid(10)
      const share: ShareRecord = {
        id: nanoid(),
        token,
        kind: input.kind,
        matterId: input.matterId,
        orgId: input.orgId,
        creatorId: input.creatorId,
        passwordHash: input.password ? hashPassword(input.password) : null,
        expiresAt: input.expiresAt ?? null,
        downloadLimit: input.downloadLimit ?? null,
        views: 0,
        downloads: 0,
        status: 'active',
        createdAt: now,
      }

      const queries: AtomicQuery[] = [db.insert(shares).values(share)]
      if (input.recipients && input.recipients.length > 0) {
        const recipientRows = input.recipients.map((r) => ({
          id: nanoid(),
          shareId: share.id,
          recipientUserId: r.recipientUserId ?? null,
          recipientEmail: r.recipientEmail ?? null,
          createdAt: now,
        }))
        queries.push(db.insert(shareRecipients).values(recipientRows))
      }

      await executeWriteTransaction(db, queries)
      return share
    },

    async resolveByToken(token: string): Promise<ShareResolution> {
      const rows = await db
        .select({ share: shares, matter: matters })
        .from(shares)
        .innerJoin(matters, eq(shares.matterId, matters.id))
        .where(eq(shares.token, token))

      const row = rows[0]
      if (!row) return { status: 'not_found' }
      if (row.share.status === 'revoked') return { status: 'revoked' }
      if (row.matter.status === 'trashed') return { status: 'matter_trashed' }

      const recipients = await db.select().from(shareRecipients).where(eq(shareRecipients.shareId, row.share.id))

      return { status: 'ok', share: row.share, matter: row.matter, recipients }
    },

    async incrementViews(shareId: string): Promise<void> {
      await db
        .update(shares)
        .set({ views: sql`${shares.views} + 1` })
        .where(eq(shares.id, shareId))
    },

    async hasDownloadsAvailable(shareId: string): Promise<boolean> {
      const nowSecs = Math.floor(Date.now() / 1000)
      const rows = await db
        .select({ id: shares.id })
        .from(shares)
        .where(
          and(
            eq(shares.id, shareId),
            eq(shares.status, 'active'),
            or(isNull(shares.downloadLimit), sql`${shares.downloads} < ${shares.downloadLimit}`),
            or(isNull(shares.expiresAt), sql`${shares.expiresAt} > ${nowSecs}`),
          ),
        )
        .limit(1)
      return rows.length === 1
    },

    async incrementDownloadsAtomic(shareId: string): Promise<{ ok: boolean; downloads: number }> {
      const nowSecs = Math.floor(Date.now() / 1000)
      const result = await db
        .update(shares)
        .set({ downloads: sql`${shares.downloads} + 1` })
        .where(
          and(
            eq(shares.id, shareId),
            eq(shares.status, 'active'),
            or(isNull(shares.downloadLimit), sql`${shares.downloads} < ${shares.downloadLimit}`),
            or(isNull(shares.expiresAt), sql`${shares.expiresAt} > ${nowSecs}`),
          ),
        )
        .returning({ downloads: shares.downloads })

      if (result.length === 1) {
        return { ok: true, downloads: result[0].downloads }
      }

      const current = await db.select({ downloads: shares.downloads }).from(shares).where(eq(shares.id, shareId))
      if (!current[0]) throw new Error('SHARE_NOT_FOUND')
      return { ok: false, downloads: current[0].downloads }
    },

    async decrementDownloads(shareId: string): Promise<void> {
      await db
        .update(shares)
        .set({ downloads: sql`CASE WHEN ${shares.downloads} > 0 THEN ${shares.downloads} - 1 ELSE 0 END` })
        .where(eq(shares.id, shareId))
    },

    async listRecipientUserIds(shareId: string): Promise<string[]> {
      const rows = await db
        .select({ userId: shareRecipients.recipientUserId })
        .from(shareRecipients)
        .where(and(eq(shareRecipients.shareId, shareId), isNotNull(shareRecipients.recipientUserId)))

      return rows.map((r) => r.userId as string)
    },

    async cascadeDeleteByMatter(matterId: string): Promise<void> {
      const shareRows = await db.select({ id: shares.id }).from(shares).where(eq(shares.matterId, matterId))
      if (shareRows.length === 0) return

      const shareIds = shareRows.map((r) => r.id)
      await executeWriteTransaction(db, [
        db.delete(shareRecipients).where(inArray(shareRecipients.shareId, shareIds)),
        db.delete(shares).where(inArray(shares.id, shareIds)),
      ])
    },

    async getCreatorByToken(token: string): Promise<string | null> {
      const rows = await db.select({ creatorId: shares.creatorId }).from(shares).where(eq(shares.token, token))
      return rows[0]?.creatorId ?? null
    },

    async revokeByToken(token: string, creatorId: string): Promise<boolean> {
      const result = await db
        .update(shares)
        .set({ status: 'revoked' })
        .where(and(eq(shares.token, token), eq(shares.creatorId, creatorId)))
        .returning({ id: shares.id })

      return result.length > 0
    },

    async listForApi(
      creatorId: string,
      opts: { page: number; pageSize: number; status?: string },
    ): Promise<{ items: ShareListItem[]; total: number }> {
      const conditions = [eq(shares.creatorId, creatorId)]
      if (opts.status) conditions.push(eq(shares.status, opts.status))
      const where = and(...conditions)

      const [countRow] = await db.select({ count: count() }).from(shares).where(where)
      const total = countRow?.count ?? 0

      const offset = (opts.page - 1) * opts.pageSize
      const rows = await db
        .select({
          id: shares.id,
          token: shares.token,
          kind: shares.kind,
          matterId: shares.matterId,
          orgId: shares.orgId,
          creatorId: shares.creatorId,
          expiresAt: shares.expiresAt,
          downloadLimit: shares.downloadLimit,
          views: shares.views,
          downloads: shares.downloads,
          status: shares.status,
          createdAt: shares.createdAt,
          matterName: matters.name,
          matterType: matters.type,
          matterDirtype: matters.dirtype,
          recipientCount: count(shareRecipients.id),
        })
        .from(shares)
        .leftJoin(matters, eq(shares.matterId, matters.id))
        .leftJoin(shareRecipients, eq(shareRecipients.shareId, shares.id))
        .where(where)
        .groupBy(shares.id)
        .orderBy(desc(shares.createdAt))
        .limit(opts.pageSize)
        .offset(offset)

      const items: ShareListItem[] = rows.map(
        ({ matterName, matterType, matterDirtype, recipientCount, ...share }) => ({
          ...share,
          matter: { name: matterName ?? '', type: matterType ?? '', dirtype: matterDirtype ?? 0 },
          recipientCount,
        }),
      )

      return { items, total }
    },

    async listReceivedForApi(
      userId: string,
      userEmail: string | null,
      opts: { page: number; pageSize: number },
    ): Promise<{ items: ShareListItem[]; total: number }> {
      const recipientMatch = userEmail
        ? or(eq(shareRecipients.recipientUserId, userId), eq(shareRecipients.recipientEmail, userEmail))
        : eq(shareRecipients.recipientUserId, userId)
      const where = and(eq(shares.status, 'active'), recipientMatch)

      const [countRow] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${shares.id})` })
        .from(shares)
        .innerJoin(shareRecipients, eq(shareRecipients.shareId, shares.id))
        .where(where)
      const total = countRow?.count ?? 0

      const offset = (opts.page - 1) * opts.pageSize
      const rows = await db
        .select({
          id: shares.id,
          token: shares.token,
          kind: shares.kind,
          matterId: shares.matterId,
          orgId: shares.orgId,
          creatorId: shares.creatorId,
          expiresAt: shares.expiresAt,
          downloadLimit: shares.downloadLimit,
          views: shares.views,
          downloads: shares.downloads,
          status: shares.status,
          createdAt: shares.createdAt,
          matterName: matters.name,
          matterType: matters.type,
          matterDirtype: matters.dirtype,
          creatorName: sql<string | null>`(SELECT name FROM user WHERE user.id = ${shares.creatorId})`,
        })
        .from(shares)
        .innerJoin(shareRecipients, eq(shareRecipients.shareId, shares.id))
        .leftJoin(matters, eq(shares.matterId, matters.id))
        .where(where)
        .groupBy(shares.id)
        .orderBy(desc(shares.createdAt))
        .limit(opts.pageSize)
        .offset(offset)

      const items: ShareListItem[] = rows.map(({ matterName, matterType, matterDirtype, creatorName, ...share }) => ({
        ...share,
        matter: { name: matterName ?? '', type: matterType ?? '', dirtype: matterDirtype ?? 0 },
        recipientCount: 0,
        creatorName: creatorName ?? undefined,
      }))

      return { items, total }
    },

    async computeSourceBytes(matter: Matter): Promise<number> {
      if (matter.dirtype === DirType.FILE) return matter.size ?? 0

      const folderPath = buildPath(matter.parent, matter.name)
      const rows = await db
        .select({ size: matters.size })
        .from(matters)
        .where(
          and(
            eq(matters.orgId, matter.orgId),
            eq(matters.status, 'active'),
            eq(matters.dirtype, DirType.FILE),
            or(eq(matters.parent, folderPath), like(matters.parent, `${folderPath}/%`)),
          ),
        )
      return rows.reduce((acc, r) => acc + (r.size ?? 0), 0)
    },

    async listDirectActiveChildren(orgId: string, folderPath: string): Promise<Matter[]> {
      return db
        .select()
        .from(matters)
        .where(and(eq(matters.orgId, orgId), eq(matters.parent, folderPath), eq(matters.status, 'active')))
    },

    hasQuotaForBytes(orgId: string, bytes: number): Promise<boolean> {
      return quota.hasQuotaForBytes(orgId, bytes)
    },

    async getCreatorName(creatorId: string): Promise<string | null> {
      const rows = await db.select({ name: user.name }).from(user).where(eq(user.id, creatorId)).limit(1)
      return rows[0]?.name ?? null
    },

    async getUserEmail(userId: string): Promise<string | null> {
      const rows = await db.select({ email: user.email }).from(user).where(eq(user.id, userId)).limit(1)
      return rows[0]?.email ?? null
    },

    async getMatterName(matterId: string): Promise<string | null> {
      const rows = await db.select({ name: matters.name }).from(matters).where(eq(matters.id, matterId)).limit(1)
      return rows[0]?.name ?? null
    },

    async findShareChildMatter(
      rootMatter: { id: string; orgId: string; parent: string; name: string },
      childId: string,
    ): Promise<Matter | null> {
      const root = buildPath(rootMatter.parent, rootMatter.name)
      const likePattern = `${escapeLike(root)}/%`
      const rows = await db
        .select()
        .from(matters)
        .where(
          and(
            eq(matters.id, childId),
            eq(matters.orgId, rootMatter.orgId),
            eq(matters.status, 'active'),
            or(eq(matters.parent, root), sql`${matters.parent} LIKE ${likePattern} ESCAPE '\\'`),
          ),
        )
      return rows[0] ?? null
    },
  }
}
