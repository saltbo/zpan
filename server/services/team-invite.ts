import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { customAlphabet, nanoid } from 'nanoid'
import { invitation, member, organization } from '../db/auth-schema'
import { teamInviteLinks } from '../db/schema'
import type { Database } from '../platform/interface'

export type TeamInviteLink = typeof teamInviteLinks.$inferSelect

const generateToken = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 32)

const DEFAULT_EXPIRES_IN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function createInviteLink(
  db: Database,
  organizationId: string,
  inviterId: string,
  role: string,
  expiresIn?: number,
): Promise<TeamInviteLink> {
  const token = generateToken()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (expiresIn ?? DEFAULT_EXPIRES_IN_MS))

  const row: TeamInviteLink = {
    id: nanoid(),
    token,
    organizationId,
    role,
    inviterId,
    expiresAt,
    createdAt: now,
  }

  await db.insert(teamInviteLinks).values(row)
  return row
}

export type InviteLinkInfo = {
  organizationId: string
  organizationName: string
  role: string
  expiresAt: Date | null
}

export async function getInviteLinkInfo(db: Database, token: string): Promise<InviteLinkInfo | null> {
  const rows = await db
    .select({
      organizationId: teamInviteLinks.organizationId,
      role: teamInviteLinks.role,
      expiresAt: teamInviteLinks.expiresAt,
      organizationName: organization.name,
    })
    .from(teamInviteLinks)
    .innerJoin(organization, eq(teamInviteLinks.organizationId, organization.id))
    .where(
      and(
        eq(teamInviteLinks.token, token),
        or(isNull(teamInviteLinks.expiresAt), gt(teamInviteLinks.expiresAt, new Date())),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null

  return {
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    role: row.role,
    expiresAt: row.expiresAt,
  }
}

export type AcceptResult = 'ok' | 'invalid' | 'expired' | 'already_member'

export async function acceptInviteLink(db: Database, token: string, userId: string): Promise<AcceptResult> {
  const rows = await db.select().from(teamInviteLinks).where(eq(teamInviteLinks.token, token)).limit(1)
  const link = rows[0]
  if (!link) return 'invalid'
  if (link.expiresAt && link.expiresAt < new Date()) return 'expired'

  const existing = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, link.organizationId), eq(member.userId, userId)))
    .limit(1)
  if (existing[0]) return 'already_member'

  await db.insert(member).values({
    id: nanoid(),
    organizationId: link.organizationId,
    userId,
    role: link.role,
    createdAt: new Date(),
  })

  return 'ok'
}

export type PendingInvitation = {
  id: string
  email: string
  role: string
  expiresAt: Date | null
  createdAt: Date
}

export async function listPendingInvitations(db: Database, organizationId: string): Promise<PendingInvitation[]> {
  const rows = await db
    .select({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), eq(invitation.status, 'pending')))
    .orderBy(desc(invitation.createdAt))

  return rows
}
