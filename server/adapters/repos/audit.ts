import { and, count, desc, eq, gte, lte } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { organization, user } from '../../db/auth-schema'
import { auditEvents } from '../../db/schema'
import { assertAuditEvent } from '../../domain/audit-events'
import type { Database } from '../../platform/interface'
import type { AuditActorType, AuditRepo, RecordAuditEventInput } from '../../usecases/ports'

export function auditEventValues(event: RecordAuditEventInput): typeof auditEvents.$inferInsert {
  assertAuditEvent(event)
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

export function idempotentSystemEventValues(input: {
  action: string
  sourceId: string
  targetId?: string
  targetName?: string
  orgId: string
  userId?: string | null
  actorType?: RecordAuditEventInput['actorType']
  actorRef?: string | null
  targetType: string
  occurredAt: Date
  metadata: Record<string, unknown>
}): typeof auditEvents.$inferInsert {
  const targetId = input.targetId ?? input.sourceId
  return {
    ...auditEventValues({
      orgId: input.orgId,
      userId: input.userId ?? null,
      actorType: input.actorType ?? 'system',
      actorRef: input.actorRef ?? 'domain',
      action: input.action,
      targetType: input.targetType,
      targetId,
      targetName: input.targetName ?? targetId,
      metadata: input.metadata,
    }),
    id: `event:${input.action}:${input.sourceId}`,
    createdAt: input.occurredAt,
  }
}

function normalizeActorType(value: string | null, userId?: string | null): AuditActorType {
  if (value === 'api_key' || value === 'anonymous' || value === 'system' || value === 'downloader') return value
  if (!userId) return 'anonymous'
  return 'user'
}

function actorDisplayName(actorType: AuditActorType, actorRef: string | null): string {
  if (actorType === 'anonymous') return 'Anonymous'
  if (actorType === 'api_key') return actorRef ? `API key:${actorRef}` : 'API key'
  if (actorType === 'system') return actorRef ? `System:${actorRef}` : 'System'
  if (actorType === 'downloader') return actorRef ? `Downloader:${actorRef}` : 'Downloader'
  return ''
}

export function createAuditRepo(db: Database): AuditRepo {
  return {
    async record(event) {
      await db.insert(auditEvents).values(auditEventValues(event))
    },

    async recordOnce(event, idempotencyKey, occurredAt = new Date()) {
      await db
        .insert(auditEvents)
        .values({
          ...auditEventValues(event),
          id: `event:${event.action}:${idempotencyKey}`,
          createdAt: occurredAt,
        })
        .onConflictDoNothing({ target: auditEvents.id })
    },

    async list(orgId, opts) {
      const page = opts.page ?? 1
      const pageSize = opts.pageSize ?? 20
      const offset = (page - 1) * pageSize
      const countRows = await db.select({ count: count() }).from(auditEvents).where(eq(auditEvents.orgId, orgId))
      const total = countRows[0]?.count ?? 0

      const rows = await db
        .select({
          id: auditEvents.id,
          orgId: auditEvents.orgId,
          userId: auditEvents.userId,
          actorType: auditEvents.actorType,
          actorRef: auditEvents.actorRef,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          targetName: auditEvents.targetName,
          metadata: auditEvents.metadata,
          createdAt: auditEvents.createdAt,
          userName: user.name,
          userImage: user.image,
        })
        .from(auditEvents)
        .leftJoin(user, eq(auditEvents.userId, user.id))
        .where(eq(auditEvents.orgId, orgId))
        .orderBy(desc(auditEvents.createdAt))
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
        opts.orgId ? eq(auditEvents.orgId, opts.orgId) : undefined,
        opts.userId ? eq(auditEvents.userId, opts.userId) : undefined,
        opts.action ? eq(auditEvents.action, opts.action) : undefined,
        opts.targetType ? eq(auditEvents.targetType, opts.targetType) : undefined,
        opts.createdFrom ? gte(auditEvents.createdAt, opts.createdFrom) : undefined,
        opts.createdTo ? lte(auditEvents.createdAt, opts.createdTo) : undefined,
      ].filter(Boolean) as Parameters<typeof and>

      const whereClause = and(...filters)
      const countRows = await db.select({ count: count() }).from(auditEvents).where(whereClause)
      const total = countRows[0]?.count ?? 0

      const rows = await db
        .select({
          id: auditEvents.id,
          orgId: auditEvents.orgId,
          userId: auditEvents.userId,
          actorType: auditEvents.actorType,
          actorRef: auditEvents.actorRef,
          action: auditEvents.action,
          targetType: auditEvents.targetType,
          targetId: auditEvents.targetId,
          targetName: auditEvents.targetName,
          metadata: auditEvents.metadata,
          createdAt: auditEvents.createdAt,
          userName: user.name,
          userImage: user.image,
          orgName: organization.name,
        })
        .from(auditEvents)
        .leftJoin(user, eq(auditEvents.userId, user.id))
        .leftJoin(organization, eq(auditEvents.orgId, organization.id))
        .where(whereClause)
        .orderBy(desc(auditEvents.createdAt))
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
        eq(auditEvents.orgId, opts.orgId),
        eq(auditEvents.targetType, opts.targetType),
        eq(auditEvents.targetId, opts.targetId),
      )

      const [countRows, rows] = await Promise.all([
        db.select({ count: count() }).from(auditEvents).where(whereClause),
        db
          .select()
          .from(auditEvents)
          .where(whereClause)
          .orderBy(desc(auditEvents.createdAt))
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
