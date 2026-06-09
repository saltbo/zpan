import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { orgQuotaEntitlements, orgQuotas } from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import {
  consumeTrafficIfQuotaAllows,
  getEffectiveQuota,
  getEffectiveQuotasByOrg,
  hasQuotaForBytes,
  hasTrafficQuotaForBytes,
  incrementUsageIfEffectiveQuotaAllows,
  refundTraffic,
  resetExpiredTrafficQuotas,
} from './effective-quota.js'

describe('effective quota', () => {
  it('returns storage and traffic quota state', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 250,
      trafficQuota: 2000,
      trafficUsed: 500,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', 'free-storage-plan', 1000, 'active', new Date('2026-05-06T00:00:00Z'), 'Free'),
        entitlement(orgId, 'traffic', 'free-traffic-plan', 2000, 'active', new Date('2026-05-06T00:00:00Z'), 'Free'),
      ])

    await expect(getEffectiveQuota(db, orgId, new Date('2026-05-06T00:00:00Z'))).resolves.toMatchObject({
      orgId,
      baseQuota: 1000,
      quota: 1000,
      used: 250,
      trafficQuota: 2000,
      trafficUsed: 500,
      trafficPeriod: '2026-05',
    })
  })

  it('adds active entitlement bytes to effective storage and traffic quota', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 250,
      trafficQuota: 2000,
      trafficUsed: 500,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values([
      entitlement(orgId, 'storage', 'free-storage-plan', 1000, 'active', now, 'Free'),
      entitlement(orgId, 'traffic', 'free-traffic-plan', 2000, 'active', now, 'Free'),
      entitlement(orgId, 'storage', 'active-storage', 300, 'active', now),
      entitlement(orgId, 'traffic', 'active-traffic', 700, 'active', now),
      entitlement(orgId, 'storage', 'revoked-storage', 900, 'revoked', now),
      {
        ...entitlement(orgId, 'storage', 'expired-storage', 900, 'active', now),
        expiresAt: new Date('2026-05-05T00:00:00Z'),
      },
    ])

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      baseQuota: 1000,
      entitlementQuota: 300,
      quota: 1300,
      baseTrafficQuota: 2000,
      entitlementTrafficQuota: 700,
      trafficQuota: 2700,
    })
  })

  it('uses the largest active subscription quota as the current plan and keeps other entitlements as extra quota', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage:${orgId}`, 3000, 'active', now),
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage_legacy:${orgId}`, 2500, 'revoked', now),
        entitlement(orgId, 'storage', 'order-storage-pack', 500, 'active', now),
        entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic:${orgId}`, 4000, 'active', now),
        entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic_legacy:${orgId}`, 3500, 'revoked', now),
        entitlement(orgId, 'traffic', 'order-traffic-pack', 700, 'active', now),
      ])

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      baseQuota: 3000,
      entitlementQuota: 500,
      quota: 3500,
      baseTrafficQuota: 4000,
      entitlementTrafficQuota: 700,
      trafficQuota: 4700,
      storagePlanName: null,
      storageExtraNames: [],
      trafficPlanName: null,
      trafficExtraNames: [],
    })
  })

  it('uses a smaller active subscription plan instead of the larger default quota', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 5000,
      used: 0,
      trafficQuota: 6000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage:${orgId}`, 3000, 'active', now),
        entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic:${orgId}`, 4000, 'active', now),
      ])

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      baseQuota: 3000,
      quota: 3000,
      baseTrafficQuota: 4000,
      trafficQuota: 4000,
    })
  })

  it('returns active plan and extra package names from entitlement metadata', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage:${orgId}`, 3000, 'active', now, 'Team Plan'),
        entitlement(orgId, 'storage', 'order-storage-pack-1', 500, 'active', now, 'Storage Pack'),
        entitlement(orgId, 'storage', 'order-storage-pack-2', 300, 'active', now, 'Archive Pack'),
        entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic:${orgId}`, 4000, 'active', now, 'Team Plan'),
        entitlement(orgId, 'traffic', 'order-traffic-pack-1', 700, 'active', now, 'Traffic Boost'),
        entitlement(orgId, 'traffic', 'order-traffic-pack-2', 200, 'active', now, 'Burst Pack'),
      ])

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      entitlementQuota: 800,
      quota: 3800,
      entitlementTrafficQuota: 900,
      trafficQuota: 4900,
      storagePlanName: 'Team Plan',
      storageExtraNames: ['Storage Pack', 'Archive Pack'],
      trafficPlanName: 'Team Plan',
      trafficExtraNames: ['Traffic Boost', 'Burst Pack'],
      currentPlan: {
        sourceId: `stripe_subscription:sub_storage:${orgId}`,
        packageId: null,
        name: 'Team Plan',
        storageBytes: 3000,
        trafficBytes: 4000,
        expiresAt: null,
        subscription: true,
      },
    })
  })

  it('returns the active subscription plan DTO from quota entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    const expiresAt = new Date('2026-06-06T00:00:00Z')
    const sourceId = `stripe_subscription:sub_plan:${orgId}`
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 100,
      trafficQuota: 2000,
      trafficUsed: 200,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values([
      {
        ...entitlement(orgId, 'storage', sourceId, 3000, 'active', now, 'Team Plan', 'pkg-team'),
        expiresAt,
      },
      {
        ...entitlement(orgId, 'traffic', sourceId, 4000, 'active', now, 'Team Plan', 'pkg-team'),
        expiresAt,
      },
    ])

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      currentPlan: {
        sourceId,
        packageId: 'pkg-team',
        name: 'Team Plan',
        storageBytes: 3000,
        trafficBytes: 4000,
        expiresAt: expiresAt.toISOString(),
        subscription: true,
      },
    })
  })

  it('ignores expired subscription plans and expired extra entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    const expiredAt = new Date('2026-05-05T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values([
      {
        ...entitlement(orgId, 'storage', `stripe_subscription:sub_storage:${orgId}`, 3000, 'active', now),
        expiresAt: expiredAt,
      },
      {
        ...entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic:${orgId}`, 4000, 'active', now),
        expiresAt: expiredAt,
      },
      {
        ...entitlement(orgId, 'storage', 'order-storage-pack', 500, 'active', now),
        expiresAt: expiredAt,
      },
      {
        ...entitlement(orgId, 'traffic', 'order-traffic-pack', 700, 'active', now),
        expiresAt: expiredAt,
      },
    ])

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      baseQuota: 0,
      entitlementQuota: 0,
      quota: 0,
      baseTrafficQuota: 0,
      entitlementTrafficQuota: 0,
      trafficQuota: 0,
    })
  })

  it('normalizes monthly traffic usage in memory without persisting when the period changes', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 2000,
      trafficUsed: 1500,
      trafficPeriod: '2026-04',
    })

    const quota = await getEffectiveQuota(db, orgId, new Date('2026-05-01T00:00:00Z'))
    expect(quota.trafficUsed).toBe(0)
    expect(quota.trafficPeriod).toBe('2026-05')

    // getEffectiveQuota is a pure read: the stale row is left untouched. The
    // monthly reset is persisted by resetExpiredTrafficQuotas (cron) or the
    // consume write path, not by reads.
    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(1500)
    expect(rows[0].trafficPeriod).toBe('2026-04')
  })

  it('persists the monthly traffic reset for stale periods and leaves current rows untouched', async () => {
    const { db } = await createTestApp()
    const staleOrg = nanoid()
    const currentOrg = nanoid()
    await db.insert(orgQuotas).values([
      {
        id: nanoid(),
        orgId: staleOrg,
        quota: 1000,
        used: 0,
        trafficQuota: 2000,
        trafficUsed: 1500,
        trafficPeriod: '2026-04',
      },
      {
        id: nanoid(),
        orgId: currentOrg,
        quota: 1000,
        used: 0,
        trafficQuota: 2000,
        trafficUsed: 700,
        trafficPeriod: '2026-05',
      },
    ])

    await resetExpiredTrafficQuotas(db, new Date('2026-05-01T00:00:00Z'))

    const stale = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, staleOrg))
    expect(stale[0].trafficUsed).toBe(0)
    expect(stale[0].trafficPeriod).toBe('2026-05')

    const current = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, currentOrg))
    expect(current[0].trafficUsed).toBe(700)
    expect(current[0].trafficPeriod).toBe('2026-05')
  })

  it('aggregates effective quotas for many orgs in a single batch matching the per-org result', async () => {
    const { db } = await createTestApp()
    const planOrg = nanoid()
    const staleOrg = nanoid()
    const emptyOrg = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')

    await db.insert(orgQuotas).values([
      {
        id: nanoid(),
        orgId: planOrg,
        quota: 0,
        used: 120,
        trafficQuota: 0,
        trafficUsed: 300,
        trafficPeriod: '2026-05',
      },
      { id: nanoid(), orgId: staleOrg, quota: 0, used: 0, trafficQuota: 0, trafficUsed: 999, trafficPeriod: '2026-04' },
      { id: nanoid(), orgId: emptyOrg, quota: 0, used: 0, trafficQuota: 0, trafficUsed: 0, trafficPeriod: '2026-05' },
    ])
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(planOrg, 'storage', `stripe_subscription:sub_storage:${planOrg}`, 3000, 'active', now, 'Team Plan'),
        entitlement(planOrg, 'storage', 'order-storage-pack', 500, 'active', now, 'Storage Pack'),
        entitlement(planOrg, 'traffic', `stripe_subscription:sub_traffic:${planOrg}`, 4000, 'active', now, 'Team Plan'),
        entitlement(planOrg, 'traffic', 'order-traffic-pack', 700, 'active', now, 'Traffic Boost'),
      ])

    const batch = await getEffectiveQuotasByOrg(db, [planOrg, staleOrg, emptyOrg], now)

    expect(batch.size).toBe(3)
    // Batch result must match the per-org function exactly.
    for (const orgId of [planOrg, staleOrg, emptyOrg]) {
      expect(batch.get(orgId)).toEqual(await getEffectiveQuota(db, orgId, now))
    }

    expect(batch.get(planOrg)).toMatchObject({
      baseQuota: 3000,
      entitlementQuota: 500,
      quota: 3500,
      used: 120,
      baseTrafficQuota: 4000,
      entitlementTrafficQuota: 700,
      trafficQuota: 4700,
      trafficUsed: 300,
      storagePlanName: 'Team Plan',
      storageExtraNames: ['Storage Pack'],
      trafficPlanName: 'Team Plan',
      trafficExtraNames: ['Traffic Boost'],
    })
    // Stale period normalized in memory.
    expect(batch.get(staleOrg)).toMatchObject({ trafficUsed: 0, trafficPeriod: '2026-05' })
    expect(batch.get(emptyOrg)).toMatchObject({ baseQuota: 0, quota: 0, trafficQuota: 0, currentPlan: null })
  })

  it('aggregates across IN-chunk boundaries for more orgs than the per-query parameter cap', async () => {
    const { db } = await createTestApp()
    const now = new Date('2026-05-06T00:00:00Z')
    // More than the 90-id chunk size to force multiple queries per table.
    const orgIds = Array.from({ length: 200 }, () => nanoid())
    await db.insert(orgQuotas).values(
      orgIds.map((orgId, i) => ({
        id: nanoid(),
        orgId,
        quota: 0,
        used: i,
        trafficQuota: 0,
        trafficUsed: 0,
        trafficPeriod: '2026-05',
      })),
    )
    // Give an org that lands in a later chunk a plan entitlement.
    const taggedOrg = orgIds[150]
    await db
      .insert(orgQuotaEntitlements)
      .values(entitlement(taggedOrg, 'storage', `stripe_subscription:sub:${taggedOrg}`, 3000, 'active', now, 'Team'))

    const batch = await getEffectiveQuotasByOrg(db, orgIds, now)

    expect(batch.size).toBe(200)
    expect(batch.get(orgIds[0])).toMatchObject({ used: 0, quota: 0 })
    expect(batch.get(orgIds[199])).toMatchObject({ used: 199, quota: 0 })
    expect(batch.get(taggedOrg)).toMatchObject({ baseQuota: 3000, quota: 3000, storagePlanName: 'Team' })
  })

  it('returns an empty map for no orgs', async () => {
    const { db } = await createTestApp()
    await expect(getEffectiveQuotasByOrg(db, [], new Date('2026-05-06T00:00:00Z'))).resolves.toEqual(new Map())
  })

  it('consumes traffic within the monthly quota and rejects overage', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 400,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values(entitlement(orgId, 'traffic', 'free-traffic-plan', 1000, 'active', now, 'Free'))

    await expect(hasTrafficQuotaForBytes(db, orgId, 600, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 600, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 1, now)).resolves.toBe(false)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(1000)
  })

  it('consumes traffic against active traffic entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 900,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'traffic', 'free-traffic-plan', 1000, 'active', now, 'Free'),
        entitlement(orgId, 'traffic', 'traffic-overage', 500, 'active', now),
      ])

    await expect(consumeTrafficIfQuotaAllows(db, orgId, 400, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 201, now)).resolves.toBe(false)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(1300)
  })

  it('enforces traffic against subscription plan plus extra entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 900,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic:${orgId}`, 2000, 'active', now),
        entitlement(orgId, 'traffic', `stripe_subscription:sub_traffic_legacy:${orgId}`, 1500, 'revoked', now),
        entitlement(orgId, 'traffic', 'traffic-pack', 500, 'active', now),
      ])

    await expect(consumeTrafficIfQuotaAllows(db, orgId, 1600, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 1, now)).resolves.toBe(false)
  })

  it('allows subscription traffic overage when the active plan has an overage price', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 900,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', `stripe_subscription:sub_plan:${orgId}`, 2000, 'active', now, 'Pro Plan'),
        entitlement(
          orgId,
          'traffic',
          `stripe_subscription:sub_plan:${orgId}`,
          2000,
          'active',
          now,
          'Pro Plan',
          'pkg-pro',
          25,
        ),
      ])

    await expect(hasTrafficQuotaForBytes(db, orgId, 1600, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 1600, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 100, now)).resolves.toBe(true)
    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({
      currentPlan: {
        name: 'Pro Plan',
        trafficBytes: 2000,
        trafficOveragePriceCents: 25,
      },
      trafficUsed: 2600,
      trafficQuota: 2000,
    })
  })

  it('treats zero base traffic quota as limited when traffic entitlements exist', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 0,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 400,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values(entitlement(orgId, 'traffic', 'traffic-zero-base', 500, 'active', now))

    await expect(hasTrafficQuotaForBytes(db, orgId, 100, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 100, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 1, now)).resolves.toBe(false)
  })

  it('refunds current monthly traffic usage', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 700,
      trafficPeriod: '2026-05',
    })

    await refundTraffic(db, orgId, 300, now)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(400)
  })

  it('clamps refunded monthly traffic usage at zero', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 100,
      trafficPeriod: '2026-05',
    })

    await refundTraffic(db, orgId, 300, now)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(0)
  })

  it('consumes traffic from zero when the period changes', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 900,
      trafficPeriod: '2026-04',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values(entitlement(orgId, 'traffic', 'free-traffic-plan', 1000, 'active', now, 'Free'))

    await expect(consumeTrafficIfQuotaAllows(db, orgId, 600, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 401, now)).resolves.toBe(false)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(600)
    expect(rows[0].trafficPeriod).toBe('2026-05')
  })

  it('retries current-period traffic consumption when another request advances the period first', async () => {
    const { db } = await createTestApp()
    const orgId = 'org-rollover-race'
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 1000,
      trafficUsed: 900,
      trafficPeriod: '2026-04',
    })
    await db.run(sql`
      CREATE TRIGGER org_quotas_rollover_race
      BEFORE UPDATE ON org_quotas
      WHEN OLD.org_id = 'org-rollover-race' AND OLD.traffic_period != '2026-05'
      BEGIN
        UPDATE org_quotas SET traffic_used = 300, traffic_period = '2026-05' WHERE org_id = OLD.org_id;
        SELECT RAISE(IGNORE);
      END
    `)

    await expect(consumeTrafficIfQuotaAllows(db, orgId, 400, now)).resolves.toBe(true)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(700)
    expect(rows[0].trafficPeriod).toBe('2026-05')
  })

  it('allows traffic when no quota row exists', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')

    await expect(hasTrafficQuotaForBytes(db, orgId, 1024, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 1024, now)).resolves.toBe(true)
  })

  it('treats zero base storage quota as limited when storage entitlements exist', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 0,
      used: 400,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values(entitlement(orgId, 'storage', 'storage-zero-base', 500, 'active', now))

    await expect(hasQuotaForBytes(db, orgId, 100)).resolves.toBe(true)
    await expect(hasQuotaForBytes(db, orgId, 101)).resolves.toBe(false)
  })

  it('enforces storage against subscription plan plus extra entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2020-01-01T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 900,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage:${orgId}`, 2000, 'active', now),
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage_legacy:${orgId}`, 1500, 'revoked', now),
        entitlement(orgId, 'storage', 'storage-pack', 500, 'active', now),
      ])

    await expect(hasQuotaForBytes(db, orgId, 1600)).resolves.toBe(true)
    await expect(hasQuotaForBytes(db, orgId, 1601)).resolves.toBe(false)
  })

  it('atomically enforces storage against the largest active subscription plan plus extra entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const storageId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 900,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db
      .insert(orgQuotaEntitlements)
      .values([
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage:${orgId}`, 2000, 'active', now),
        entitlement(orgId, 'storage', `stripe_subscription:sub_storage_legacy:${orgId}`, 1500, 'revoked', now),
        entitlement(orgId, 'storage', 'storage-pack', 500, 'active', now),
      ])

    await expect(incrementUsageIfEffectiveQuotaAllows(db, orgId, storageId, 1600, true, now)).resolves.toBe(true)
    await expect(incrementUsageIfEffectiveQuotaAllows(db, orgId, storageId, 1, true, now)).resolves.toBe(false)
  })
})

function entitlement(
  orgId: string,
  resourceType: 'storage' | 'traffic',
  sourceId: string,
  bytes: number,
  status: string,
  now: Date,
  packageName?: string,
  packageId?: string,
  trafficOveragePriceCents?: number,
): typeof orgQuotaEntitlements.$inferInsert {
  const metadata =
    packageName || trafficOveragePriceCents !== undefined
      ? JSON.stringify({
          packageId: packageId ?? null,
          packageName: packageName ?? null,
          trafficOveragePriceCents: trafficOveragePriceCents ?? null,
        })
      : null
  return {
    id: nanoid(),
    orgId,
    resourceType,
    entitlementType: sourceId.startsWith('stripe_subscription:') || sourceId.endsWith('-plan') ? 'plan' : 'grant',
    source: 'test',
    sourceId,
    bytes,
    startsAt: now,
    expiresAt: null,
    status,
    metadata,
    createdAt: now,
    updatedAt: now,
  }
}
