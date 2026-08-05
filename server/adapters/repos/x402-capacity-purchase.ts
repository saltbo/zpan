import { and, eq, isNull, lt, or, sql } from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { x402CapacityPurchaseIntents } from '../../db/schema'
import { executeWriteTransactionWithResults } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type { X402CapacityPurchaseRepo } from '../../usecases/ports'

const MAX_PENDING_INTENTS_PER_ORG = 5
const MAX_INTENTS_PER_HOUR_PER_ORG = 20
const INTENT_CREATION_WINDOW_MS = 60 * 60 * 1000
const PENDING_INTENT_TTL_MS = 15 * 60 * 1000
const ABANDONED_INTENT_RETENTION_MS = 24 * 60 * 60 * 1000

export function createX402CapacityPurchaseRepo(db: Database): X402CapacityPurchaseRepo {
  return {
    async get(orgId, resourceId, requestHash) {
      const rows = await db
        .select()
        .from(x402CapacityPurchaseIntents)
        .where(
          and(
            eq(x402CapacityPurchaseIntents.orgId, orgId),
            eq(x402CapacityPurchaseIntents.resourceId, resourceId),
            eq(x402CapacityPurchaseIntents.requestHash, requestHash),
          ),
        )
        .limit(1)
      return rows[0] ?? null
    },
    async create(input) {
      const now = new Date()
      const nowMs = now.getTime()
      const id = generateId()
      const abandonedBefore = new Date(nowMs - PENDING_INTENT_TTL_MS)
      const creationWindowStart = new Date(nowMs - INTENT_CREATION_WINDOW_MS)
      const retentionBefore = new Date(nowMs - ABANDONED_INTENT_RETENTION_MS)
      const cleanup = db.delete(x402CapacityPurchaseIntents).where(sql`
        ${x402CapacityPurchaseIntents.updatedAt} < ${retentionBefore.getTime()}
        AND ${x402CapacityPurchaseIntents.status} IN ('created', 'ordering', 'ordered', 'quoted', 'expired', 'failed', 'canceled')
      `)
      const insert = db
        .insert(x402CapacityPurchaseIntents)
        .select(sql`
          SELECT
            ${id}, ${input.orgId}, ${input.resourceId}, ${input.requestHash}, ${input.idempotencyKey},
            NULL, NULL, 'created', NULL, ${nowMs}, ${nowMs}
          WHERE (
            SELECT COUNT(*) FROM ${x402CapacityPurchaseIntents}
            WHERE ${x402CapacityPurchaseIntents.orgId} = ${input.orgId}
              AND ${x402CapacityPurchaseIntents.createdAt} >= ${creationWindowStart.getTime()}
          ) < ${MAX_INTENTS_PER_HOUR_PER_ORG}
          AND (
            SELECT COUNT(*) FROM ${x402CapacityPurchaseIntents}
            WHERE ${x402CapacityPurchaseIntents.orgId} = ${input.orgId}
              AND ${x402CapacityPurchaseIntents.status} IN ('created', 'ordering', 'ordered', 'quoted')
              AND (
                (${x402CapacityPurchaseIntents.status} = 'quoted'
                  AND (${x402CapacityPurchaseIntents.expiresAt} IS NULL OR ${x402CapacityPurchaseIntents.expiresAt} > ${nowMs}))
                OR (${x402CapacityPurchaseIntents.status} <> 'quoted' AND ${x402CapacityPurchaseIntents.updatedAt} >= ${abandonedBefore.getTime()})
              )
          ) < ${MAX_PENDING_INTENTS_PER_ORG}
        `)
        .returning()
      const [, inserted] = await executeWriteTransactionWithResults(db, [cleanup, insert], [1])
      return (inserted as (typeof x402CapacityPurchaseIntents.$inferSelect)[] | undefined)?.[0] ?? null
    },
    async claimCloudOrder(id, staleBefore) {
      const rows = await db
        .update(x402CapacityPurchaseIntents)
        .set({ status: 'ordering', updatedAt: new Date() })
        .where(
          and(
            eq(x402CapacityPurchaseIntents.id, id),
            isNull(x402CapacityPurchaseIntents.cloudOrderId),
            or(
              eq(x402CapacityPurchaseIntents.status, 'created'),
              and(
                eq(x402CapacityPurchaseIntents.status, 'ordering'),
                lt(x402CapacityPurchaseIntents.updatedAt, staleBefore),
              ),
            ),
          ),
        )
        .returning({ id: x402CapacityPurchaseIntents.id })
      return rows.length === 1
    },
    async updateCloudState(id, input) {
      await db
        .update(x402CapacityPurchaseIntents)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(x402CapacityPurchaseIntents.id, id))
    },
  }
}
