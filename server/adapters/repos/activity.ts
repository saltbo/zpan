import { and, count, desc, eq, gte, lte, notInArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { organization, user } from '../../db/auth-schema'
import { activityEvents } from '../../db/schema'
import { assertAdminStatsEvent } from '../../domain/admin-stats-events'
import type { Database } from '../../platform/interface'
import type { ActivityActorType, ActivityRepo, RecordActivityInput } from '../../usecases/ports'
import { ADMIN_STATS_FACT_ACTIONS } from './admin-stats-fact'

export function activityEventValues(event: RecordActivityInput): typeof activityEvents.$inferInsert {
  assertAdminStatsEvent(event.action, event.metadata)
  return {
    id: nanoid(),
    orgId: event.orgId,
    userId: event.userId ?? null,
    actorType: event.actorType ?? (event.userId ? 'user' : 'anonymous'),
    actorRef: event.actorRef ?? null,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId ?? null,
    targetName: event.targetName,
    metadata: event.metadata ? JSON.stringify(event.metadata) : null,
    createdAt: new Date(),
  }
}

function normalizeActorType(value: string | null, userId?: string | null): ActivityActorType {
  if (value === 'anonymous' || value === 'system' || value === 'downloader') return value
  if (!userId) return 'anonymous'
  return 'user'
}

function actorDisplayName(actorType: ActivityActorType, actorRef: string | null): string {
  if (actorType === 'anonymous') return 'Anonymous'
  if (actorType === 'system') return actorRef ? `System:${actorRef}` : 'System'
  if (actorType === 'downloader') return actorRef ? `Downloader:${actorRef}` : 'Downloader'
  return ''
}

export function createActivityRepo(db: Database): ActivityRepo {
  return {
    async record(event) {
      await db.insert(activityEvents).values(activityEventValues(event))
    },

    async list(orgId, opts) {
      const page = opts.page ?? 1
      const pageSize = opts.pageSize ?? 20
      const offset = (page - 1) * pageSize

      const visible = and(
        eq(activityEvents.orgId, orgId),
        notInArray(activityEvents.action, [...ADMIN_STATS_FACT_ACTIONS]),
      )
      const countRows = await db.select({ count: count() }).from(activityEvents).where(visible)
      const total = countRows[0]?.count ?? 0

      const rows = await db
        .select({
          id: activityEvents.id,
          orgId: activityEvents.orgId,
          userId: activityEvents.userId,
          actorType: activityEvents.actorType,
          actorRef: activityEvents.actorRef,
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
        .where(visible)
        .orderBy(desc(activityEvents.createdAt))
        .limit(pageSize)
        .offset(offset)

      const items = rows.map((row) => {
        const actorType = normalizeActorType(row.actorType, row.userId)
        return {
          id: row.id,
          orgId: row.orgId,
          userId: row.userId,
          actorType,
          actorRef: row.actorRef,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          targetName: row.targetName,
          metadata: row.metadata,
          createdAt: row.createdAt,
          user: {
            id: row.userId,
            name: row.userName ?? actorDisplayName(actorType, row.actorRef),
            image: row.userImage ?? null,
          },
        }
      })

      return { items, total }
    },

    async listAdminAudit(opts) {
      const page = opts.page ?? 1
      const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20))
      const offset = (page - 1) * pageSize

      const filters = [
        notInArray(activityEvents.action, [...ADMIN_STATS_FACT_ACTIONS]),
        opts.orgId ? eq(activityEvents.orgId, opts.orgId) : undefined,
        opts.userId ? eq(activityEvents.userId, opts.userId) : undefined,
        opts.action ? eq(activityEvents.action, opts.action) : undefined,
        opts.targetType ? eq(activityEvents.targetType, opts.targetType) : undefined,
        opts.createdFrom ? gte(activityEvents.createdAt, opts.createdFrom) : undefined,
        opts.createdTo ? lte(activityEvents.createdAt, opts.createdTo) : undefined,
      ].filter(Boolean) as Parameters<typeof and>

      const whereClause = filters.length > 0 ? and(...filters) : undefined

      const countRows = await db.select({ count: count() }).from(activityEvents).where(whereClause)
      const total = countRows[0]?.count ?? 0

      const rows = await db
        .select({
          id: activityEvents.id,
          orgId: activityEvents.orgId,
          userId: activityEvents.userId,
          actorType: activityEvents.actorType,
          actorRef: activityEvents.actorRef,
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

      const items = rows.map((row) => {
        const actorType = normalizeActorType(row.actorType, row.userId)
        return {
          id: row.id,
          orgId: row.orgId,
          userId: row.userId,
          actorType,
          actorRef: row.actorRef,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          targetName: row.targetName,
          metadata: row.metadata,
          createdAt: row.createdAt,
          user: {
            id: row.userId,
            name: row.userName ?? actorDisplayName(actorType, row.actorRef),
            image: row.userImage ?? null,
          },
          orgName: row.orgName ?? null,
        }
      })

      return { items, total, page, pageSize }
    },

    async listByTarget(opts) {
      const page = opts.page ?? 1
      const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50))
      const offset = (page - 1) * pageSize
      const whereClause = and(
        eq(activityEvents.orgId, opts.orgId),
        eq(activityEvents.targetType, opts.targetType),
        eq(activityEvents.targetId, opts.targetId),
        notInArray(activityEvents.action, [...ADMIN_STATS_FACT_ACTIONS]),
      )

      const [countRows, rows] = await Promise.all([
        db.select({ count: count() }).from(activityEvents).where(whereClause),
        db
          .select()
          .from(activityEvents)
          .where(whereClause)
          .orderBy(desc(activityEvents.createdAt))
          .limit(pageSize)
          .offset(offset),
      ])

      return {
        items: rows.map((row) => ({
          ...row,
          actorType: normalizeActorType(row.actorType, row.userId),
        })),
        total: countRows[0]?.count ?? 0,
        page,
        pageSize,
      }
    },
  }
}
