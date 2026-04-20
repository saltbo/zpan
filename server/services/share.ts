import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { DirType } from '../../shared/constants'
import type { CreateShareInput } from '../../shared/schemas/share'
import { matters, shareRecipients, shares } from '../db/schema'
import { hashPassword, verifyPassword as verifyPasswordHash } from '../lib/password'
import type { Database } from '../platform/interface'
import type { Matter } from './matter'

export type Share = typeof shares.$inferSelect
export type ShareRecipient = typeof shareRecipients.$inferSelect
export type ShareWithDetails = Share & {
  matter: { name: string; type: string; dirtype: number }
  recipients: ShareRecipient[]
}
export type ShareListItem = Share & {
  matter: { name: string; type: string; dirtype: number }
  recipientCount: number
}

export function verifyPassword(share: Share, plaintext: string): boolean {
  if (!share.passwordHash) return false
  return verifyPasswordHash(share.passwordHash, plaintext)
}

export function isAccessibleByUser(recipients: ShareRecipient[], userId: string): boolean {
  return recipients.some((r) => r.recipientUserId === userId)
}

export async function createShare(db: Database, input: CreateShareInput): Promise<Share> {
  if (input.kind === 'direct' && input.password) throw new Error('DIRECT_NO_PASSWORD')
  if (input.kind === 'direct' && input.recipients && input.recipients.length > 0)
    throw new Error('DIRECT_NO_RECIPIENTS')

  const matter = await db
    .select()
    .from(matters)
    .where(and(eq(matters.id, input.matterId), eq(matters.orgId, input.orgId)))
    .then((rows) => rows[0] ?? null)

  if (!matter) throw new Error('MATTER_NOT_FOUND')
  if (input.kind === 'direct' && matter.dirtype !== DirType.FILE) throw new Error('DIRECT_NO_FOLDER')

  const now = new Date()
  const share: Share = {
    id: nanoid(),
    token: nanoid(10),
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

  await db.insert(shares).values(share)

  if (input.recipients && input.recipients.length > 0) {
    const recipientRows: ShareRecipient[] = input.recipients.map((r) => ({
      id: nanoid(),
      shareId: share.id,
      recipientUserId: r.recipientUserId ?? null,
      recipientEmail: r.recipientEmail ?? null,
      createdAt: now,
    }))
    await db.insert(shareRecipients).values(recipientRows)
  }

  return share
}

export type ShareResolution =
  | { status: 'ok'; share: Share; matter: Matter; recipients: ShareRecipient[] }
  | { status: 'not_found' | 'revoked' | 'matter_trashed' }

export async function resolveShareByToken(db: Database, token: string): Promise<ShareResolution> {
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
}

export async function incrementViews(db: Database, shareId: string): Promise<void> {
  await db
    .update(shares)
    .set({ views: sql`${shares.views} + 1` })
    .where(eq(shares.id, shareId))
}

export async function incrementDownloadsAtomic(
  db: Database,
  shareId: string,
): Promise<{ ok: boolean; downloads: number }> {
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
}

export async function revokeShare(db: Database, shareId: string, creatorId: string): Promise<void> {
  const result = await db
    .update(shares)
    .set({ status: 'revoked' })
    .where(and(eq(shares.id, shareId), eq(shares.creatorId, creatorId)))
    .returning({ id: shares.id })

  if (result.length === 0) throw new Error('SHARE_NOT_FOUND_OR_FORBIDDEN')
}

export async function listShareRecipientUserIds(db: Database, shareId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: shareRecipients.recipientUserId })
    .from(shareRecipients)
    .where(and(eq(shareRecipients.shareId, shareId), isNotNull(shareRecipients.recipientUserId)))

  return rows.map((r) => r.userId as string)
}

export async function cascadeDeleteByMatter(db: Database, matterId: string): Promise<void> {
  const shareRows = await db.select({ id: shares.id }).from(shares).where(eq(shares.matterId, matterId))
  if (shareRows.length === 0) return

  const shareIds = shareRows.map((r) => r.id)
  await db.delete(shareRecipients).where(inArray(shareRecipients.shareId, shareIds))
  await db.delete(shares).where(inArray(shares.id, shareIds))
}

export async function getShareById(db: Database, shareId: string): Promise<ShareWithDetails | null> {
  const rows = await db
    .select({ share: shares, matter: matters })
    .from(shares)
    .innerJoin(matters, eq(shares.matterId, matters.id))
    .where(eq(shares.id, shareId))

  const row = rows[0]
  if (!row) return null

  const recipients = await db.select().from(shareRecipients).where(eq(shareRecipients.shareId, shareId))

  return {
    ...row.share,
    matter: { name: row.matter.name, type: row.matter.type, dirtype: row.matter.dirtype ?? 0 },
    recipients,
  }
}

export async function listSharesForApi(
  db: Database,
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
      share: shares,
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

  const items: ShareListItem[] = rows.map(({ share, matterName, matterType, matterDirtype, recipientCount }) => ({
    ...share,
    matter: { name: matterName ?? '', type: matterType ?? '', dirtype: matterDirtype ?? 0 },
    recipientCount,
  }))

  return { items, total }
}
