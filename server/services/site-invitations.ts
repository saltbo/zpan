import { and, count, desc, eq, gt, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { SiteInvitation } from '../../shared/types'
import * as authSchema from '../db/auth-schema'
import { siteInvitations, systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

const SITE_INVITE_EXPIRY_MS = 1000 * 60 * 60 * 24 * 7

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function mapStatus(row: typeof siteInvitations.$inferSelect): SiteInvitation['status'] {
  if (row.revokedAt) return 'revoked'
  if (row.acceptedAt) return 'accepted'
  if (row.expiresAt < new Date()) return 'expired'
  return 'pending'
}

function mapInvitation(row: typeof siteInvitations.$inferSelect & { invitedByName: string | null }): SiteInvitation {
  return {
    id: row.id,
    email: row.email,
    token: row.token,
    invitedBy: row.invitedBy,
    invitedByName: row.invitedByName ?? row.invitedBy,
    acceptedBy: row.acceptedBy,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    revokedBy: row.revokedBy,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    status: mapStatus(row),
  }
}

export async function getSiteName(db: Database): Promise<string> {
  const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, 'site_name')).limit(1)
  return rows[0]?.value?.trim() || 'ZPan'
}

export async function listSiteInvitations(
  db: Database,
  page: number,
  pageSize: number,
): Promise<{ items: SiteInvitation[]; total: number }> {
  const [totalResult, rows] = await Promise.all([
    db.select({ count: count() }).from(siteInvitations),
    db
      .select({
        id: siteInvitations.id,
        email: siteInvitations.email,
        token: siteInvitations.token,
        invitedBy: siteInvitations.invitedBy,
        acceptedBy: siteInvitations.acceptedBy,
        acceptedAt: siteInvitations.acceptedAt,
        revokedBy: siteInvitations.revokedBy,
        revokedAt: siteInvitations.revokedAt,
        expiresAt: siteInvitations.expiresAt,
        createdAt: siteInvitations.createdAt,
        updatedAt: siteInvitations.updatedAt,
        invitedByName: authSchema.user.name,
      })
      .from(siteInvitations)
      .leftJoin(authSchema.user, eq(authSchema.user.id, siteInvitations.invitedBy))
      .orderBy(desc(siteInvitations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return {
    items: rows.map(mapInvitation),
    total: totalResult[0]?.count ?? 0,
  }
}

export async function createSiteInvitation(
  db: Database,
  adminUserId: string,
  rawEmail: string,
): Promise<SiteInvitation> {
  const email = normalizeEmail(rawEmail)
  const now = new Date()

  const [existingUser] = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.email, email))
    .limit(1)
  if (existingUser) throw new Error('A user with this email already exists')

  const [pendingInvite] = await db
    .select()
    .from(siteInvitations)
    .where(
      and(
        eq(siteInvitations.email, email),
        isNull(siteInvitations.acceptedAt),
        isNull(siteInvitations.revokedAt),
        gt(siteInvitations.expiresAt, now),
      ),
    )
    .orderBy(desc(siteInvitations.createdAt))
    .limit(1)
  if (pendingInvite) throw new Error('A pending invitation already exists for this email')

  const row: typeof siteInvitations.$inferInsert = {
    id: nanoid(),
    email,
    token: nanoid(32),
    invitedBy: adminUserId,
    acceptedBy: null,
    acceptedAt: null,
    revokedBy: null,
    revokedAt: null,
    expiresAt: new Date(now.getTime() + SITE_INVITE_EXPIRY_MS),
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(siteInvitations).values(row)
  const [createdBy] = await db
    .select({ name: authSchema.user.name })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, adminUserId))
    .limit(1)

  return mapInvitation({
    ...row,
    acceptedBy: row.acceptedBy ?? null,
    acceptedAt: row.acceptedAt ?? null,
    revokedBy: row.revokedBy ?? null,
    revokedAt: row.revokedAt ?? null,
    invitedByName: createdBy?.name ?? adminUserId,
  })
}

export async function resendSiteInvitation(
  db: Database,
  invitationId: string,
): Promise<SiteInvitation | 'not_found' | 'already_accepted' | 'already_revoked'> {
  const [row] = await db.select().from(siteInvitations).where(eq(siteInvitations.id, invitationId)).limit(1)
  if (!row) return 'not_found'
  if (row.acceptedAt) return 'already_accepted'
  if (row.revokedAt) return 'already_revoked'

  const now = new Date()
  const nextToken = nanoid(32)
  await db
    .update(siteInvitations)
    .set({
      token: nextToken,
      expiresAt: new Date(now.getTime() + SITE_INVITE_EXPIRY_MS),
      updatedAt: now,
    })
    .where(eq(siteInvitations.id, invitationId))

  const [updated] = await db
    .select({
      id: siteInvitations.id,
      email: siteInvitations.email,
      token: siteInvitations.token,
      invitedBy: siteInvitations.invitedBy,
      acceptedBy: siteInvitations.acceptedBy,
      acceptedAt: siteInvitations.acceptedAt,
      revokedBy: siteInvitations.revokedBy,
      revokedAt: siteInvitations.revokedAt,
      expiresAt: siteInvitations.expiresAt,
      createdAt: siteInvitations.createdAt,
      updatedAt: siteInvitations.updatedAt,
      invitedByName: authSchema.user.name,
    })
    .from(siteInvitations)
    .leftJoin(authSchema.user, eq(authSchema.user.id, siteInvitations.invitedBy))
    .where(eq(siteInvitations.id, invitationId))
    .limit(1)

  return mapInvitation(updated)
}

export async function revokeSiteInvitation(
  db: Database,
  invitationId: string,
  adminUserId: string,
): Promise<'ok' | 'not_found' | 'already_accepted' | 'already_revoked'> {
  const [row] = await db.select().from(siteInvitations).where(eq(siteInvitations.id, invitationId)).limit(1)
  if (!row) return 'not_found'
  if (row.acceptedAt) return 'already_accepted'
  if (row.revokedAt) return 'already_revoked'

  await db
    .update(siteInvitations)
    .set({
      revokedBy: adminUserId,
      revokedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(siteInvitations.id, invitationId))

  return 'ok'
}

export async function getSiteInvitationByToken(db: Database, token: string): Promise<SiteInvitation | null> {
  const [row] = await db
    .select({
      id: siteInvitations.id,
      email: siteInvitations.email,
      token: siteInvitations.token,
      invitedBy: siteInvitations.invitedBy,
      acceptedBy: siteInvitations.acceptedBy,
      acceptedAt: siteInvitations.acceptedAt,
      revokedBy: siteInvitations.revokedBy,
      revokedAt: siteInvitations.revokedAt,
      expiresAt: siteInvitations.expiresAt,
      createdAt: siteInvitations.createdAt,
      updatedAt: siteInvitations.updatedAt,
      invitedByName: authSchema.user.name,
    })
    .from(siteInvitations)
    .leftJoin(authSchema.user, eq(authSchema.user.id, siteInvitations.invitedBy))
    .where(eq(siteInvitations.token, token))
    .limit(1)
  return row ? mapInvitation(row) : null
}

export async function validateSiteInvitation(
  db: Database,
  token: string,
  rawEmail: string,
): Promise<{ valid: boolean; error?: string }> {
  const email = normalizeEmail(rawEmail)
  const invitation = await getSiteInvitationByToken(db, token)
  if (!invitation) return { valid: false, error: 'Invalid invitation' }
  if (invitation.revokedAt) return { valid: false, error: 'Invitation has been revoked' }
  if (invitation.acceptedAt) return { valid: false, error: 'Invitation has already been used' }
  if (new Date(invitation.expiresAt) < new Date()) return { valid: false, error: 'Invitation has expired' }
  if (invitation.email !== email) return { valid: false, error: 'Invitation email does not match' }
  return { valid: true }
}

export async function acceptSiteInvitation(
  db: Database,
  token: string,
  rawEmail: string,
  userId: string,
): Promise<'ok' | 'not_found' | 'revoked' | 'accepted' | 'expired' | 'email_mismatch'> {
  const email = normalizeEmail(rawEmail)
  const [row] = await db.select().from(siteInvitations).where(eq(siteInvitations.token, token)).limit(1)
  if (!row) return 'not_found'
  if (row.revokedAt) return 'revoked'
  if (row.acceptedAt) return 'accepted'
  if (row.expiresAt < new Date()) return 'expired'
  if (row.email !== email) return 'email_mismatch'

  await db
    .update(siteInvitations)
    .set({
      acceptedBy: userId,
      acceptedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(siteInvitations.token, token),
        isNull(siteInvitations.acceptedAt),
        isNull(siteInvitations.revokedAt),
        gt(siteInvitations.expiresAt, new Date()),
        eq(siteInvitations.email, email),
      ),
    )

  const [updated] = await db
    .select({ acceptedBy: siteInvitations.acceptedBy, acceptedAt: siteInvitations.acceptedAt })
    .from(siteInvitations)
    .where(eq(siteInvitations.token, token))
    .limit(1)

  if (updated?.acceptedBy === userId && updated.acceptedAt) return 'ok'
  if (updated?.acceptedBy) return 'accepted'
  return 'accepted'
}
