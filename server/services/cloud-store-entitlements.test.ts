import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { orgQuotaEntitlements, orgQuotas } from '../db/schema'
import { createTestApp } from '../test/setup'
import { processCloudOrderQuotaChange } from './cloud-store'

describe('processCloudOrderQuotaChange entitlements', () => {
  it('creates storage entitlements without mutating base storage quota and treats duplicate webhooks as idempotent', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-idempotent',
      orgId: 'org-webhook-idempotent',
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const event = {
      eventId: 'evt-webhook-idempotent',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-idempotent',
      targetOrgId: 'org-webhook-idempotent',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
      occurredAt: '2026-05-06T00:00:00Z',
    }

    await expect(
      processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-webhook-idempotent'),
    ).resolves.toEqual({
      duplicate: false,
      eventId: event.eventId,
    })
    await expect(
      processCloudOrderQuotaChange(db, event, JSON.stringify(event), 'hash-webhook-idempotent'),
    ).resolves.toEqual({
      duplicate: true,
      eventId: event.eventId,
    })

    const quotaRows = await db.all<{ quota: number; trafficQuota: number }>(sql`
      SELECT quota, traffic_quota AS trafficQuota FROM org_quotas WHERE org_id = ${event.targetOrgId}
    `)
    expect(quotaRows[0]).toEqual({ quota: 1000, trafficQuota: 2000 })

    const entitlementRows = await db.all<{ resourceType: string; bytes: number; status: string }>(sql`
      SELECT resource_type AS resourceType, bytes, status
      FROM org_quota_entitlements
      WHERE org_id = ${event.targetOrgId}
      ORDER BY resource_type
    `)
    expect(entitlementRows).toEqual([{ resourceType: 'storage', bytes: 4096, status: 'active' }])
  })

  it('applies traffic quota changes to local traffic quota', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-traffic',
      orgId: 'org-webhook-traffic',
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const increase = {
      eventId: 'evt-webhook-traffic-increase',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-traffic',
      targetOrgId: 'org-webhook-traffic',
      direction: 'increase' as const,
      storageBytes: 0,
      trafficBytes: 8192,
      occurredAt: '2026-05-06T00:00:00Z',
    }
    const decrease = {
      ...increase,
      eventId: 'evt-webhook-traffic-decrease',
      direction: 'decrease' as const,
      trafficBytes: 1024,
    }

    await processCloudOrderQuotaChange(db, increase, JSON.stringify(increase), 'hash-webhook-traffic-increase')
    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-traffic-decrease')

    const quotaRows = await db.all<{ quota: number; trafficQuota: number }>(sql`
      SELECT quota, traffic_quota AS trafficQuota FROM org_quotas WHERE org_id = ${increase.targetOrgId}
    `)
    expect(quotaRows[0]).toEqual({ quota: 1000, trafficQuota: 9168 })

    const entitlementRows = await db.all<{ resourceType: string }>(sql`
      SELECT resource_type AS resourceType
      FROM org_quota_entitlements
      WHERE org_id = ${increase.targetOrgId}
    `)
    expect(entitlementRows).toEqual([])
  })

  it('accumulates repeated storage increases for the same cloud order', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-repeat-increase',
      orgId: 'org-webhook-repeat-increase',
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const firstIncrease = {
      eventId: 'evt-webhook-repeat-increase-a',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-repeat-increase',
      targetOrgId: 'org-webhook-repeat-increase',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
      occurredAt: '2026-05-06T00:00:00Z',
    }
    const secondIncrease = {
      ...firstIncrease,
      eventId: 'evt-webhook-repeat-increase-b',
      storageBytes: 1024,
    }

    await processCloudOrderQuotaChange(
      db,
      firstIncrease,
      JSON.stringify(firstIncrease),
      'hash-webhook-repeat-increase-a',
    )
    await processCloudOrderQuotaChange(
      db,
      secondIncrease,
      JSON.stringify(secondIncrease),
      'hash-webhook-repeat-increase-b',
    )

    const entitlementRows = await db.all<{ bytes: number; status: string }>(sql`
      SELECT bytes, status
      FROM org_quota_entitlements
      WHERE org_id = ${firstIncrease.targetOrgId} AND source_id = ${firstIncrease.cloudOrderId}
    `)
    expect(entitlementRows).toEqual([{ bytes: 5120, status: 'active' }])
  })

  it('revokes matching cloud order entitlements on reversal', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-reversal',
      orgId: 'org-webhook-reversal',
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const increase = {
      eventId: 'evt-webhook-increase',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-reversal',
      targetOrgId: 'org-webhook-reversal',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
      occurredAt: '2026-05-06T00:00:00Z',
    }
    const decrease = {
      ...increase,
      eventId: 'evt-webhook-decrease',
      direction: 'decrease' as const,
    }

    await processCloudOrderQuotaChange(db, increase, JSON.stringify(increase), 'hash-webhook-increase')
    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-decrease')

    const entitlementRows = await db.all<{ status: string; expiresAt: number | null }>(sql`
      SELECT status, expires_at AS expiresAt
      FROM org_quota_entitlements
      WHERE org_id = ${increase.targetOrgId} AND source_id = ${increase.cloudOrderId}
    `)
    expect(entitlementRows).toHaveLength(1)
    expect(entitlementRows[0].status).toBe('revoked')
    expect(entitlementRows[0].expiresAt).not.toBeNull()
  })

  it('does not apply a repeated reversal after the matching entitlement is revoked', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-repeat-reversal',
      orgId: 'org-webhook-repeat-reversal',
      quota: 10000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const increase = {
      eventId: 'evt-webhook-repeat-increase',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-repeat-reversal',
      targetOrgId: 'org-webhook-repeat-reversal',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
      occurredAt: '2026-05-06T00:00:00Z',
    }
    const decrease = {
      ...increase,
      eventId: 'evt-webhook-repeat-decrease',
      direction: 'decrease' as const,
    }
    const repeatedDecrease = {
      ...decrease,
      eventId: 'evt-webhook-repeat-decrease-again',
    }

    await processCloudOrderQuotaChange(db, increase, JSON.stringify(increase), 'hash-webhook-repeat-increase')
    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-repeat-decrease')
    await processCloudOrderQuotaChange(
      db,
      repeatedDecrease,
      JSON.stringify(repeatedDecrease),
      'hash-webhook-repeat-decrease-again',
    )

    const quotaRows = await db.all<{ quota: number }>(sql`
      SELECT quota FROM org_quotas WHERE org_id = ${increase.targetOrgId}
    `)
    expect(quotaRows[0].quota).toBe(10000)

    const entitlementRows = await db.all<{ status: string }>(sql`
      SELECT status FROM org_quota_entitlements WHERE org_id = ${increase.targetOrgId}
    `)
    expect(entitlementRows).toEqual([{ status: 'revoked' }])
  })

  it('partially reduces matching cloud order entitlements on reversal', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-partial-reversal',
      orgId: 'org-webhook-partial-reversal',
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const increase = {
      eventId: 'evt-webhook-partial-increase',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-partial-reversal',
      targetOrgId: 'org-webhook-partial-reversal',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
      occurredAt: '2026-05-06T00:00:00Z',
    }
    const decrease = {
      ...increase,
      eventId: 'evt-webhook-partial-decrease',
      direction: 'decrease' as const,
      storageBytes: 1024,
    }

    await processCloudOrderQuotaChange(db, increase, JSON.stringify(increase), 'hash-webhook-partial-increase')
    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-partial-decrease')

    const entitlementRows = await db.all<{ bytes: number; status: string }>(sql`
      SELECT bytes, status
      FROM org_quota_entitlements
      WHERE org_id = ${increase.targetOrgId} AND source_id = ${increase.cloudOrderId}
    `)
    expect(entitlementRows).toEqual([{ bytes: 3072, status: 'active' }])
  })

  it('falls back to legacy base quota for oversized matching reversals', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-oversized-reversal',
      orgId: 'org-webhook-oversized-reversal',
      quota: 10000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    const increase = {
      eventId: 'evt-webhook-oversized-increase',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-webhook-oversized-reversal',
      targetOrgId: 'org-webhook-oversized-reversal',
      direction: 'increase' as const,
      storageBytes: 4096,
      trafficBytes: 0,
      occurredAt: '2026-05-06T00:00:00Z',
    }
    const decrease = {
      ...increase,
      eventId: 'evt-webhook-oversized-decrease',
      direction: 'decrease' as const,
      storageBytes: 5000,
    }

    await processCloudOrderQuotaChange(db, increase, JSON.stringify(increase), 'hash-webhook-oversized-increase')
    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-oversized-decrease')

    const quotaRows = await db.all<{ quota: number }>(sql`
      SELECT quota FROM org_quotas WHERE org_id = ${increase.targetOrgId}
    `)
    expect(quotaRows[0].quota).toBe(9096)

    const entitlementRows = await db.all<{ status: string }>(sql`
      SELECT status FROM org_quota_entitlements WHERE org_id = ${increase.targetOrgId}
    `)
    expect(entitlementRows).toEqual([{ status: 'revoked' }])
  })

  it('reduces active entitlements before falling back to legacy base quota on unmatched decreases', async () => {
    const { db } = await createTestApp()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-unmatched-decrease',
      orgId: 'org-webhook-unmatched-decrease',
      quota: 10000,
      used: 0,
      trafficQuota: 20000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values([
      {
        id: 'entitlement-unmatched-storage-a',
        orgId: 'org-webhook-unmatched-decrease',
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-existing-storage-a',
        bytes: 1000,
        startsAt: now,
        expiresAt: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'entitlement-unmatched-storage-b',
        orgId: 'org-webhook-unmatched-decrease',
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-existing-storage-b',
        bytes: 2000,
        startsAt: now,
        expiresAt: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    ])
    const decrease = {
      eventId: 'evt-webhook-unmatched-decrease',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-without-active-entitlement',
      targetOrgId: 'org-webhook-unmatched-decrease',
      direction: 'decrease' as const,
      storageBytes: 3500,
      trafficBytes: 1000,
      occurredAt: '2026-05-07T00:00:00Z',
    }

    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-unmatched-decrease')

    const quotaRows = await db.all<{ quota: number; trafficQuota: number }>(sql`
      SELECT quota, traffic_quota AS trafficQuota
      FROM org_quotas
      WHERE org_id = ${decrease.targetOrgId}
    `)
    expect(quotaRows[0]).toEqual({ quota: 9500, trafficQuota: 19000 })

    const entitlementRows = await db.all<{ id: string; bytes: number; status: string }>(sql`
      SELECT id, bytes, status
      FROM org_quota_entitlements
      WHERE org_id = ${decrease.targetOrgId}
      ORDER BY id
    `)
    expect(entitlementRows).toEqual([
      { id: 'entitlement-unmatched-storage-a', bytes: 1000, status: 'revoked' },
      { id: 'entitlement-unmatched-storage-b', bytes: 2000, status: 'revoked' },
    ])
  })

  it('ignores inactive entitlement windows on unmatched decreases', async () => {
    const { db } = await createTestApp()
    await db.insert(orgQuotas).values({
      id: 'quota-webhook-windowed-decrease',
      orgId: 'org-webhook-windowed-decrease',
      quota: 10000,
      used: 0,
      trafficQuota: 20000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values([
      {
        id: 'entitlement-windowed-future',
        orgId: 'org-webhook-windowed-decrease',
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-windowed-future',
        bytes: 1000,
        startsAt: new Date('2026-06-01T00:00:00Z'),
        expiresAt: null,
        status: 'active',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z'),
      },
      {
        id: 'entitlement-windowed-expired',
        orgId: 'org-webhook-windowed-decrease',
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-windowed-expired',
        bytes: 1000,
        startsAt: new Date('2026-04-01T00:00:00Z'),
        expiresAt: new Date('2026-05-01T00:00:00Z'),
        status: 'active',
        createdAt: new Date('2026-04-01T00:00:00Z'),
        updatedAt: new Date('2026-04-01T00:00:00Z'),
      },
    ])
    const decrease = {
      eventId: 'evt-webhook-windowed-decrease',
      eventType: 'order.quota_changed' as const,
      cloudOrderId: 'order-windowed-missing',
      targetOrgId: 'org-webhook-windowed-decrease',
      direction: 'decrease' as const,
      storageBytes: 500,
      trafficBytes: 0,
      occurredAt: '2026-05-07T00:00:00Z',
    }

    await processCloudOrderQuotaChange(db, decrease, JSON.stringify(decrease), 'hash-webhook-windowed-decrease')

    const quotaRows = await db.all<{ quota: number }>(sql`
      SELECT quota FROM org_quotas WHERE org_id = ${decrease.targetOrgId}
    `)
    expect(quotaRows[0].quota).toBe(9500)

    const entitlementRows = await db.all<{ id: string; status: string }>(sql`
      SELECT id, status
      FROM org_quota_entitlements
      WHERE org_id = ${decrease.targetOrgId}
      ORDER BY id
    `)
    expect(entitlementRows).toEqual([
      { id: 'entitlement-windowed-expired', status: 'active' },
      { id: 'entitlement-windowed-future', status: 'active' },
    ])
  })
})
