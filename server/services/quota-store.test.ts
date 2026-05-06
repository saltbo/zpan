import { describe, expect, it } from 'vitest'
import { activityEvents, orgQuotas, quotaDeliveryEvents } from '../db/schema'
import type { Database } from '../platform/interface'
import { processCloudDelivery } from './quota-store'

function createAsyncDb(quotaRows: Array<{ id: string }> = [{ id: 'quota-1' }]) {
  const state = {
    audits: 0,
    deliveryStatus: '',
    quotaUpdates: 0,
  }
  const db = {
    constructor: { name: 'AsyncTestDatabase' },
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
    insert: (table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        if (table === quotaDeliveryEvents) state.deliveryStatus = String(values.status)
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
          if (table === quotaDeliveryEvents) state.deliveryStatus = String(values.status)
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
    deliveryStatus: '',
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
              if (table === quotaDeliveryEvents) state.deliveryStatus = String(values.status)
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
            state.deliveryStatus = String(values.status)
            return { run: () => undefined }
          },
        }),
      }
    }
  }

  return { db: new BetterSQLite3Database() as unknown as Database, state }
}

describe('processCloudDelivery', () => {
  it('processes delivery with an async transaction database', async () => {
    const { db, state } = createAsyncDb()
    const event = {
      eventId: 'evt-async',
      targetOrgId: 'org-async',
      resourceType: 'storage' as const,
      operation: 'increase' as const,
      resourceBytes: 4096,
    }

    await expect(processCloudDelivery(db, event, JSON.stringify(event), 'hash-async')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-async',
    })
    expect(state).toMatchObject({ audits: 1, deliveryStatus: 'processed', quotaUpdates: 1 })
  })

  it('processes delivery with a sync transaction database', async () => {
    const { db, state } = createSyncDb()
    const event = {
      eventId: 'evt-sync',
      targetOrgId: 'org-sync',
      resourceType: 'traffic' as const,
      operation: 'decrease' as const,
      resourceBytes: 2048,
    }

    await expect(processCloudDelivery(db, event, JSON.stringify(event), 'hash-sync')).resolves.toEqual({
      duplicate: false,
      eventId: 'evt-sync',
    })
    expect(state).toMatchObject({ audits: 1, deliveryStatus: 'processed', quotaUpdates: 1 })
  })

  it('marks async delivery failed when the target quota is missing', async () => {
    const { db, state } = createAsyncDb([])
    const event = {
      eventId: 'evt-async-missing',
      targetOrgId: 'org-missing',
      resourceType: 'traffic' as const,
      operation: 'decrease' as const,
      resourceBytes: 1024,
    }

    await expect(processCloudDelivery(db, event, JSON.stringify(event), 'hash-missing')).rejects.toThrow(
      'target_quota_missing',
    )
    expect(state).toMatchObject({ audits: 0, deliveryStatus: 'failed', quotaUpdates: 1 })
  })

  it('surfaces delivery event insert failures', async () => {
    const event = {
      eventId: 'evt-insert-failed',
      targetOrgId: 'org-failed',
      resourceType: 'storage' as const,
      operation: 'increase' as const,
      resourceBytes: 1024,
    }

    await expect(
      processCloudDelivery(createFailingBeginDb(), event, JSON.stringify(event), 'hash-failed'),
    ).rejects.toThrow('insert failed')
  })
})
