import { describe, expect, it } from 'vitest'
import { activityEvents, orgQuotaEntitlements, orgQuotas, webhookEvents } from '../db/schema'
import type { Database } from '../platform/interface'
import { processCloudOrderQuotaChange } from './cloud-store'

function createAsyncDb(
  quotaRows: Array<{ id: string }> = [{ id: 'quota-1' }],
  entitlementRevokeRows: Array<{ id: string }> = [{ id: 'entitlement-revoked' }],
  existingEntitlementRows: Array<{ id: string }> = [],
) {
  const state = {
    audits: 0,
    batches: 0,
    webhookStatus: '',
    entitlementInserts: 0,
    entitlementRevokes: 0,
    legacyQuotaUpdates: 0,
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async () => {
      throw new Error('failed_query_begin_params')
    },
    batch: async (queries: Array<Promise<unknown>>) => {
      state.batches += 1
      return Promise.all(queries)
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const apply = () => {
          if (table === webhookEvents) state.webhookStatus = String(values.status)
          if (table === activityEvents) state.audits += 1
          if (table === orgQuotaEntitlements) state.entitlementInserts += Array.isArray(values) ? values.length : 1
        }
        if (table === orgQuotaEntitlements) return { onConflictDoUpdate: async () => apply() }
        return Promise.resolve(apply())
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === orgQuotas) return quotaRows
            if (table === orgQuotaEntitlements) return existingEntitlementRows
            return []
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === orgQuotaEntitlements) {
            state.entitlementRevokes += 1
            return Promise.resolve(entitlementRevokeRows)
          }
          if (table === orgQuotas && existingEntitlementRows.length === 0) state.legacyQuotaUpdates += 1
          if (table === webhookEvents) state.webhookStatus = String(values.status)
          return Promise.resolve()
        },
      }),
    }),
  }

  return { db: db as unknown as Database, state }
}

function createFailingBeginDb() {
  return {
    insert: () => ({
      values: async () => {
        throw new Error('insert failed')
      },
    }),
  } as unknown as Database
}

function createUniqueConflictDb(existing: { id: string; payloadHash: string; status: string } | null) {
  const state = {
    audits: 0,
    batches: 0,
    webhookStatus: existing?.status ?? '',
    entitlementInserts: 0,
    entitlementRevokes: 0,
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async () => {
      throw new Error('failed_query_begin_params')
    },
    batch: async (queries: Array<Promise<unknown>>) => {
      state.batches += 1
      return Promise.all(queries)
    },
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === webhookEvents) throw new Error('UNIQUE constraint failed: webhook_events.source, event_id')
        if (table === activityEvents) state.audits += 1
        if (table === orgQuotaEntitlements) state.entitlementInserts += Array.isArray(values) ? values.length : 1
        return values
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            if (table === webhookEvents) return existing ? [existing] : []
            if (table === orgQuotas) return [{ id: 'quota-retry' }]
            return []
          },
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === orgQuotaEntitlements) {
            state.entitlementRevokes += 1
            return Promise.resolve([{ id: 'entitlement-revoked' }])
          }
          if (table === webhookEvents) state.webhookStatus = String(values.status)
          return Promise.resolve()
        },
      }),
    }),
  }

  return { db: db as unknown as Database, state }
}

function createSyncDb(
  entitlementRevokeRows: Array<{ id: string }> = [{ id: 'entitlement-revoked' }],
  existingEntitlementRows: Array<{ id: string }> = [],
) {
  const state = {
    audits: 0,
    webhookStatus: '',
    entitlementInserts: 0,
    entitlementRevokes: 0,
    legacyQuotaUpdates: 0,
  }

  class BetterSQLite3Database {
    transaction(fn: (tx: unknown) => void) {
      fn(this)
    }

    insert(table: unknown) {
      return {
        values: (values: Record<string, unknown>) => {
          const apply = () => {
            if (table === webhookEvents) state.webhookStatus = String(values.status)
            if (table === activityEvents) state.audits += 1
            if (table === orgQuotaEntitlements) state.entitlementInserts += Array.isArray(values) ? values.length : 1
          }
          return {
            run: apply,
            onConflictDoUpdate: () => ({ run: apply }),
          }
        },
      }
    }

    select() {
      return {
        from: (table: unknown) => ({
          where: () => ({
            limit: () => ({
              all: () => {
                if (table === orgQuotas) return [{ id: 'quota-sync' }]
                if (table === orgQuotaEntitlements) return existingEntitlementRows
                return []
              },
            }),
          }),
        }),
      }
    }

    update(table: unknown) {
      return {
        set: (values: Record<string, unknown>) => ({
          where: () => {
            if (table === orgQuotaEntitlements) {
              return {
                returning: () => ({
                  all: () => {
                    state.entitlementRevokes += 1
                    return entitlementRevokeRows
                  },
                }),
              }
            }
            if (table === orgQuotas) state.legacyQuotaUpdates += 1
            state.webhookStatus = String(values.status)
            return { run: () => undefined }
          },
        }),
      }
    }
  }

  return { db: new BetterSQLite3Database() as unknown as Database, state }
}

describe('processCloudOrderQuotaChange', () => {
  it('processes quota change with an async D1 batch transaction database', async () => {
    const { db, state } = createAsyncDb()
    const event = {
      eventId: 'evt-async',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-async',
      targetOrgId: 'org-async',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-async')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-async',
    })
    expect(state).toMatchObject({ audits: 1, batches: 1, webhookStatus: 'processed', entitlementInserts: 1 })
  })

  it('processes quota change with a sync transaction database', async () => {
    const { db, state } = createSyncDb()
    const event = {
      eventId: 'evt-sync',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-sync',
      targetOrgId: 'org-sync',
      direction: 'decrease' as const,
      storageBytes: 0,
      trafficBytes: 2048,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-sync')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-sync',
    })
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', entitlementRevokes: 1 })
  })

  it('applies legacy base quota decrease with a sync transaction database', async () => {
    const { db, state } = createSyncDb([], [])
    const event = {
      eventId: 'evt-sync-legacy',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-sync-legacy',
      targetOrgId: 'org-sync-legacy',
      direction: 'decrease' as const,
      storageBytes: 4096,
      trafficBytes: 0,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-sync-legacy')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-sync-legacy',
    })
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', legacyQuotaUpdates: 1 })
  })

  it('does not apply sync legacy base decrease when a matching entitlement already exists', async () => {
    const { db, state } = createSyncDb([], [{ id: 'entitlement-revoked' }])
    const event = {
      eventId: 'evt-sync-existing',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-sync-existing',
      targetOrgId: 'org-sync-existing',
      direction: 'decrease' as const,
      storageBytes: 4096,
      trafficBytes: 0,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-sync-existing')).resolves.toEqual(
      {
        duplicate: false,
        eventId: 'evt-sync-existing',
      },
    )
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', legacyQuotaUpdates: 0 })
  })

  it('applies legacy base quota decrease when no entitlement exists for the Cloud order', async () => {
    const { db, state } = createAsyncDb([{ id: 'quota-legacy' }], [], [])
    const event = {
      eventId: 'evt-legacy-decrease',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-legacy-decrease',
      targetOrgId: 'org-legacy',
      direction: 'decrease' as const,
      storageBytes: 4096,
      trafficBytes: 2048,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-legacy')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-legacy-decrease',
    })
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', legacyQuotaUpdates: 1 })
  })

  it('does not apply legacy base decrease when a matching entitlement already exists', async () => {
    const { db, state } = createAsyncDb([{ id: 'quota-existing-entitlement' }], [], [{ id: 'entitlement-revoked' }])
    const event = {
      eventId: 'evt-existing-entitlement-decrease',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-existing-entitlement',
      targetOrgId: 'org-existing-entitlement',
      direction: 'decrease' as const,
      storageBytes: 4096,
      trafficBytes: 0,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-existing')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-existing-entitlement-decrease',
    })
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', legacyQuotaUpdates: 0 })
  })

  it('marks async quota change failed when the target quota is missing', async () => {
    const { db, state } = createAsyncDb([])
    const event = {
      eventId: 'evt-async-missing',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-missing',
      targetOrgId: 'org-missing',
      direction: 'decrease' as const,
      storageBytes: 0,
      trafficBytes: 1024,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-missing')).rejects.toThrow(
      'target_quota_missing',
    )
    expect(state).toMatchObject({ audits: 0, webhookStatus: 'failed', entitlementRevokes: 0 })
  })

  it('surfaces quota change webhook insert failures', async () => {
    const event = {
      eventId: 'evt-insert-failed',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-failed',
      targetOrgId: 'org-failed',
      direction: 'increase' as const,
      storageBytes: 1024,
      trafficBytes: 0,
    }

    await expect(
      processCloudOrderQuotaChange(createFailingBeginDb(), event, JSON.stringify(event), 'hash-failed'),
    ).rejects.toThrow('insert failed')
  })

  it('treats an existing processed webhook event as a duplicate', async () => {
    const { db, state } = createUniqueConflictDb({
      id: 'webhook-processed',
      payloadHash: 'hash-duplicate',
      status: 'processed',
    })
    const event = {
      eventId: 'evt-duplicate',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-duplicate',
      targetOrgId: 'org-duplicate',
      direction: 'increase' as const,
      storageBytes: 1024,
      trafficBytes: 2048,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-duplicate')).resolves.toEqual({
      duplicate: true,
      eventId: 'evt-duplicate',
    })
    expect(state).toMatchObject({ audits: 0, webhookStatus: 'processed', entitlementInserts: 0 })
  })

  it('rejects duplicate webhook events when the payload hash changes', async () => {
    const { db } = createUniqueConflictDb({
      id: 'webhook-conflict',
      payloadHash: 'hash-original',
      status: 'failed',
    })
    const event = {
      eventId: 'evt-conflict',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-conflict',
      targetOrgId: 'org-conflict',
      direction: 'increase' as const,
      storageBytes: 1024,
      trafficBytes: 2048,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-changed')).rejects.toThrow(
      'webhook_payload_conflict',
    )
  })

  it('reprocesses failed webhook events when the payload is unchanged', async () => {
    const { db, state } = createUniqueConflictDb({
      id: 'webhook-failed',
      payloadHash: 'hash-retry',
      status: 'failed',
    })
    const event = {
      eventId: 'evt-retry',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-retry',
      targetOrgId: 'org-retry',
      direction: 'decrease' as const,
      storageBytes: 4096,
      trafficBytes: 1024,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-retry')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-retry',
    })
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', entitlementRevokes: 2 })
  })
})
