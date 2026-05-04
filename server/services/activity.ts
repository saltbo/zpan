import { and, count, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { organization, user } from '../db/auth-schema'
import { activityEvents } from '../db/schema'
import type { Database } from '../platform/interface'

export type ActivityEventRow = typeof activityEvents.$inferSelect

export interface ActivityEventWithUser extends ActivityEventRow {
  user: { id: string; name: string; image: string | null }
}

interface RecordActivityInput {
  orgId: string
  userId: string
  action: string
  targetType: string
  targetId?: string
  targetName: string
  metadata?: Record<string, unknown>
}

export async function recordActivity(db: Database, event: RecordActivityInput): Promise<void> {
  await db.insert(activityEvents).values({
    id: nanoid(),
    orgId: event.orgId,
    userId: event.userId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    targetName: event.targetName,
    metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    createdAt: new Date(),
  })
}

export async function listActivities(
  db: Database,
  orgId: string,
  opts: { page?: number; pageSize?: number },
): Promise<{ items: ActivityEventWithUser[]; total: number }> {
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const offset = (page - 1) * pageSize

  const countRows = await db.select({ count: count() }).from(activityEvents).where(eq(activityEvents.orgId, orgId))
  const total = countRows[0]?.count ?? 0

  const rows = await db
    .select({
      id: activityEvents.id,
      orgId: activityEvents.orgId,
      userId: activityEvents.userId,
      action: activityEvents.action,
      targetType: activityEvents.targetType,
      targetId: activityEvents.targetId,
      targetName: activityEvents.targetName,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
      userName: user.name,
      userImage: user.image,
    })
    .from(activityEvents)
    .leftJoin(user, eq(activityEvents.userId, user.id))
    .where(eq(activityEvents.orgId, orgId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(pageSize)
    .offset(offset)

  const items = rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    metadata: row.metadata,
    createdAt: row.createdAt,
    user: { id: row.userId, name: row.userName ?? '', image: row.userImage ?? null },
  }))

  return { items, total }
}

export interface AdminAuditEventWithOrg extends ActivityEventWithUser {
  orgName: string | null
}

interface ListAdminAuditOpts {
  page?: number
  pageSize?: number
  orgId?: string
  userId?: string
  action?: string
  targetType?: string
}

export async function listAdminAuditEvents(
  db: Database,
  opts: ListAdminAuditOpts,
): Promise<{ items: AdminAuditEventWithOrg[]; total: number; page: number; pageSize: number }> {
  const page = opts.page ?? 1
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))
  const offset = (page - 1) * pageSize

  const filters = [
    opts.orgId ? eq(activityEvents.orgId, opts.orgId) : undefined,
    opts.userId ? eq(activityEvents.userId, opts.userId) : undefined,
    opts.action ? eq(activityEvents.action, opts.action) : undefined,
    opts.targetType ? eq(activityEvents.targetType, opts.targetType) : undefined,
  ].filter(Boolean) as Parameters<typeof and>

  const whereClause = filters.length > 0 ? and(...filters) : undefined

  const countRows = await db.select({ count: count() }).from(activityEvents).where(whereClause)
  const total = countRows[0]?.count ?? 0

  const rows = await db
    .select({
      id: activityEvents.id,
      orgId: activityEvents.orgId,
      userId: activityEvents.userId,
      action: activityEvents.action,
      targetType: activityEvents.targetType,
      targetId: activityEvents.targetId,
      targetName: activityEvents.targetName,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
      userName: user.name,
      userImage: user.image,
      orgName: organization.name,
    })
    .from(activityEvents)
    .leftJoin(user, eq(activityEvents.userId, user.id))
    .leftJoin(organization, eq(activityEvents.orgId, organization.id))
    .where(whereClause)
    .orderBy(desc(activityEvents.createdAt))
    .limit(pageSize)
    .offset(offset)

  const items = rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    metadata: row.metadata,
    createdAt: row.createdAt,
    user: { id: row.userId, name: row.userName ?? '', image: row.userImage ?? null },
    orgName: row.orgName ?? null,
  }))

  return { items, total, page, pageSize }
}
