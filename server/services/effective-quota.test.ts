import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { orgQuotaEntitlements, orgQuotas } from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import {
  consumeTrafficIfQuotaAllows,
  getEffectiveQuota,
  hasQuotaForBytes,
  hasTrafficQuotaForBytes,
  refundTraffic,
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

  it('resets monthly traffic usage when the period changes', async () => {
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

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(0)
    expect(rows[0].trafficPeriod).toBe('2026-05')
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
    await db.insert(orgQuotaEntitlements).values(entitlement(orgId, 'traffic', 'traffic-overage', 500, 'active', now))

    await expect(consumeTrafficIfQuotaAllows(db, orgId, 400, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 201, now)).resolves.toBe(false)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(1300)
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
})

function entitlement(
  orgId: string,
  resourceType: 'storage' | 'traffic',
  sourceId: string,
  bytes: number,
  status: string,
  now: Date,
): typeof orgQuotaEntitlements.$inferInsert {
  return {
    id: nanoid(),
    orgId,
    resourceType,
    source: 'test',
    sourceId,
    bytes,
    startsAt: now,
    expiresAt: null,
    status,
    metadata: null,
    createdAt: now,
    updatedAt: now,
  }
}
