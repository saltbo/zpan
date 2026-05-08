import { describe, expect, it } from 'vitest'
import { activityEvents, orgQuotaEntitlements, orgQuotas, webhookEvents } from '../db/schema'
import type { Database } from '../platform/interface'
import { processCloudOrderQuotaChange } from './cloud-store'

function queryRows<T>(rows: T[]) {
  return {
    all: () => rows,
    limit: async () => rows,
    orderBy: async () => rows,
    // biome-ignore lint/suspicious/noThenProperty: Drizzle async queries are thenable; these fakes mimic that API.
    then: (resolve: (value: T[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  }
}

function createAsyncDb(quotaRows: Array<{ id: string }> = [{ id: 'quota-1' }]) {
  const state = {
    audits: 0,
    entitlementRevokes: 0,
    entitlementUpserts: 0,
    legacyQuotaReversals: 0,
    webhookStatus: '',
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === webhookEvents) {
          state.webhookStatus = String(values.status)
          return Promise.resolve()
        }
        if (table === activityEvents) {
          state.audits += 1
          return Promise.resolve()
        }
        return {
          onConflictDoUpdate: async () => {
            state.entitlementUpserts += 1
          },
        }
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === orgQuotas) return queryRows(quotaRows)
          if (table === orgQuotaEntitlements) return queryRows([{ id: 'entitlement-1', bytes: 4096, status: 'active' }])
          return queryRows([])
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === orgQuotaEntitlements) {
            state.entitlementRevokes += 1
            return {
              returning: async () => {
                return [{ id: 'entitlement-1' }]
              },
              run: () => undefined,
            }
          }
          if (table === orgQuotas) {
            state.legacyQuotaReversals += 1
            return Promise.resolve()
          }
          if (table === webhookEvents) state.webhookStatus = String(values.status)
          return Promise.resolve()
        },
      }),
    }),
  }

  return { db: db as unknown as Database, state }
}

function createLegacyReversalDb() {
  const state = {
    audits: 0,
    entitlementRevokes: 0,
    entitlementUpserts: 0,
    legacyQuotaReversals: 0,
    webhookStatus: '',
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === webhookEvents) {
          state.webhookStatus = String(values.status)
          return Promise.resolve()
        }
        if (table === activityEvents) {
          state.audits += 1
          return Promise.resolve()
        }
        return {
          onConflictDoUpdate: async () => {
            state.entitlementUpserts += 1
          },
        }
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === orgQuotas ? [{ id: 'quota-legacy' }] : []
          return queryRows(rows)
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === orgQuotaEntitlements) {
            state.entitlementRevokes += 1
            return {
              returning: async () => {
                return []
              },
              run: () => undefined,
            }
          }
          if (table === orgQuotas) {
            state.legacyQuotaReversals += 1
            return Promise.resolve()
          }
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

function createUniqueConflictDb(
  existing: { id: string; payloadHash: string; status: string; createdAt?: Date } | null,
  claimRows: Array<{ id: string }> = existing ? [{ id: existing.id }] : [],
) {
  const state = {
    audits: 0,
    entitlementRevokes: 0,
    entitlementUpserts: 0,
    legacyQuotaReversals: 0,
    webhookStatus: existing?.status ?? '',
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    insert: (table: unknown) => ({
      values: (_values: Record<string, unknown>) => {
        if (table === webhookEvents) throw new Error('UNIQUE constraint failed: webhook_events.source, event_id')
        if (table === activityEvents) {
          state.audits += 1
          return Promise.resolve()
        }
        return {
          onConflictDoUpdate: async () => {
            state.entitlementUpserts += 1
          },
        }
      },
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          if (table === webhookEvents) return queryRows(existing ? [existing] : [])
          if (table === orgQuotas) return queryRows([{ id: 'quota-retry' }])
          if (table === orgQuotaEntitlements) {
            return queryRows([{ id: 'entitlement-retry', bytes: 999999, status: 'active' }])
          }
          return queryRows([])
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === orgQuotaEntitlements) {
            state.entitlementRevokes += 1
            return {
              returning: async () => {
                return [{ id: 'entitlement-retry' }]
              },
              run: () => undefined,
            }
          }
          if (table === orgQuotas) state.legacyQuotaReversals += 1
          if (table === webhookEvents) {
            state.webhookStatus = String(values.status)
            return { returning: async () => claimRows }
          }
          return Promise.resolve()
        },
      }),
    }),
  }

  return { db: db as unknown as Database, state }
}

function createSyncDb() {
  const state = {
    audits: 0,
    entitlementRevokes: 0,
    entitlementUpserts: 0,
    legacyQuotaReversals: 0,
    webhookStatus: '',
  }

  class BetterSQLite3Database {
    transaction(fn: (tx: unknown) => void) {
      fn(this)
    }

    insert(table: unknown) {
      return {
        values: (values: Record<string, unknown>) => {
          if (table === orgQuotaEntitlements) {
            return {
              onConflictDoUpdate: () => ({
                run: () => {
                  state.entitlementUpserts += 1
                },
              }),
            }
          }
          return {
            run: () => {
              if (table === webhookEvents) state.webhookStatus = String(values.status)
              if (table === activityEvents) state.audits += 1
            },
          }
        },
      }
    }

    select() {
      return {
        from: (table: unknown) => ({
          where: () => {
            const rows =
              table === orgQuotas
                ? [{ id: 'quota-sync' }]
                : table === orgQuotaEntitlements
                  ? [{ id: 'entitlement-sync', bytes: 999999, status: 'active' }]
                  : []
            return {
              all: () => rows,
              limit: () => ({ all: () => rows }),
            }
          },
        }),
      }
    }

    update(table: unknown) {
      return {
        set: (values: Record<string, unknown>) => ({
          where: () => {
            if (table === orgQuotaEntitlements) {
              state.entitlementRevokes += 1
              return {
                returning: () => ({
                  all: () => {
                    return [{ id: 'entitlement-sync' }]
                  },
                }),
                run: () => undefined,
              }
            }
            if (table === orgQuotas) {
              state.legacyQuotaReversals += 1
              return { run: () => undefined }
            }
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
  it('processes quota change with an async transaction database', async () => {
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
    expect(state).toMatchObject({ audits: 1, entitlementUpserts: 1, webhookStatus: 'processed' })
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
    expect(state).toMatchObject({ audits: 1, legacyQuotaReversals: 1, webhookStatus: 'processed' })
  })

  it('reverses legacy base quota when a decrease has no matching entitlement', async () => {
    const { db, state } = createLegacyReversalDb()
    const event = {
      eventId: 'evt-legacy-reversal',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-legacy',
      targetOrgId: 'org-legacy',
      direction: 'decrease' as const,
      storageBytes: 4096,
      trafficBytes: 0,
    }

    await expect(processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-legacy')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-legacy-reversal',
    })
    expect(state).toMatchObject({ audits: 1, entitlementRevokes: 0, legacyQuotaReversals: 1 })
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
    expect(state).toMatchObject({ audits: 0, webhookStatus: 'processed', entitlementUpserts: 0 })
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

  it('treats a stale processing webhook as duplicate when another retry claims it first', async () => {
    const { db, state } = createUniqueConflictDb(
      {
        id: 'webhook-stale-processing-lost',
        payloadHash: 'hash-stale-processing-lost',
        status: 'processing',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
      [],
    )
    const event = {
      eventId: 'evt-stale-processing-lost',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-stale-processing-lost',
      targetOrgId: 'org-stale-processing-lost',
      direction: 'decrease' as const,
      storageBytes: 1024,
      trafficBytes: 0,
    }

    await expect(
      processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-stale-processing-lost'),
    ).resolves.toEqual({
      duplicate: true,
      eventId: 'evt-stale-processing-lost',
    })
    expect(state).toMatchObject({ audits: 0, entitlementRevokes: 0, legacyQuotaReversals: 0 })
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
    expect(state).toMatchObject({
      audits: 1,
      entitlementRevokes: 1,
      legacyQuotaReversals: 1,
      webhookStatus: 'processed',
    })
  })
})
