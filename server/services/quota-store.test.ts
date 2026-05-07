import { describe, expect, it } from 'vitest'
import { activityEvents, orgQuotas, webhookEvents } from '../db/schema'
import type { Database } from '../platform/interface'
import { processCloudOrderQuotaChange } from './quota-store'

function createAsyncDb(quotaRows: Array<{ id: string }> = [{ id: 'quota-1' }]) {
  const state = {
    audits: 0,
    webhookStatus: '',
    quotaUpdates: 0,
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === webhookEvents) state.webhookStatus = String(values.status)
        if (table === activityEvents) state.audits += 1
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === orgQuotas) {
            return {
              returning: async () => {
                state.quotaUpdates += 1
                return quotaRows
              },
            }
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

function createSyncDb() {
  const state = {
    audits: 0,
    webhookStatus: '',
    quotaUpdates: 0,
  }

  class BetterSQLite3Database {
    transaction(fn: (tx: unknown) => void) {
      fn(this)
    }

    insert(table: unknown) {
      return {
        values: (values: Record<string, unknown>) => {
          return {
            run: () => {
              if (table === webhookEvents) state.webhookStatus = String(values.status)
              if (table === activityEvents) state.audits += 1
            },
          }
        },
      }
    }

    update(table: unknown) {
      return {
        set: (values: Record<string, unknown>) => ({
          where: () => {
            if (table === orgQuotas) {
              return {
                returning: () => ({
                  all: () => {
                    state.quotaUpdates += 1
                    return [{ id: 'quota-sync' }]
                  },
                }),
              }
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
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', quotaUpdates: 1 })
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
    expect(state).toMatchObject({ audits: 1, webhookStatus: 'processed', quotaUpdates: 1 })
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
    expect(state).toMatchObject({ audits: 0, webhookStatus: 'failed', quotaUpdates: 1 })
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
})
