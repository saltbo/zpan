import { and, asc, count, eq, gt, inArray, lt, max, min } from 'drizzle-orm'
import { resourceChanges } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type {
  RecordResourceChangeInput,
  ResourceChange,
  ResourceChangeRepo,
  ResourceChangeScopeType,
} from '../../usecases/ports'

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  return JSON.parse(value) as Record<string, unknown>
}

function toResourceChange(row: typeof resourceChanges.$inferSelect): ResourceChange {
  return {
    sequence: row.sequence,
    scopeType: row.scopeType as ResourceChangeScopeType,
    scopeId: row.scopeId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    changeType: row.changeType as ResourceChange['changeType'],
    action: row.action,
    metadata: parseMetadata(row.metadata),
    occurredAt: row.occurredAt,
  }
}

export function resourceChangeQuery(db: Database, input: RecordResourceChangeInput) {
  return db.insert(resourceChanges).values({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    changeType: input.changeType,
    action: input.action ?? null,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    occurredAt: input.occurredAt,
  })
}

export function createResourceChangeRepo(db: Database): ResourceChangeRepo {
  return {
    async listAfter(input) {
      if (input.resourceTypes?.length === 0) return []
      const resourceTypeFilter = input.resourceTypes?.length
        ? inArray(resourceChanges.resourceType, input.resourceTypes)
        : undefined
      const rows = await db
        .select()
        .from(resourceChanges)
        .where(
          and(
            eq(resourceChanges.scopeType, input.scopeType),
            eq(resourceChanges.scopeId, input.scopeId),
            resourceTypeFilter,
            gt(resourceChanges.sequence, input.sequence),
          ),
        )
        .orderBy(asc(resourceChanges.sequence))
        .limit(input.limit)
      return rows.map(toResourceChange)
    },

    async oldestSequence(input) {
      if (input.resourceTypes?.length === 0) return null
      const resourceTypeFilter = input.resourceTypes?.length
        ? inArray(resourceChanges.resourceType, input.resourceTypes)
        : undefined
      const rows = await db
        .select({ sequence: min(resourceChanges.sequence) })
        .from(resourceChanges)
        .where(
          and(
            eq(resourceChanges.scopeType, input.scopeType),
            eq(resourceChanges.scopeId, input.scopeId),
            resourceTypeFilter,
          ),
        )
      return rows[0]?.sequence == null ? null : Number(rows[0].sequence)
    },

    async latestSequence(input) {
      const rows = await db
        .select({ sequence: max(resourceChanges.sequence) })
        .from(resourceChanges)
        .where(and(eq(resourceChanges.scopeType, input.scopeType), eq(resourceChanges.scopeId, input.scopeId)))
      return rows[0]?.sequence == null ? 0 : Number(rows[0].sequence)
    },

    async purgeBefore(cutoff) {
      const rows = await db
        .select({ total: count() })
        .from(resourceChanges)
        .where(lt(resourceChanges.occurredAt, cutoff))
      await db.delete(resourceChanges).where(lt(resourceChanges.occurredAt, cutoff))
      return Number(rows[0]?.total ?? 0)
    },
  }
}
