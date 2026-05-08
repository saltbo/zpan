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

  it('adds active entitlement bytes to finite storage and traffic quotas', async () => {
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
    const timestamp = new Date('2026-05-01T00:00:00Z')
    await db.insert(orgQuotaEntitlements).values([
      {
        id: nanoid(),
        orgId,
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-storage-a',
        bytes: 400,
        startsAt: timestamp,
        expiresAt: null,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: nanoid(),
        orgId,
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-storage-b',
        bytes: 200,
        startsAt: timestamp,
        expiresAt: null,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: nanoid(),
        orgId,
        resourceType: 'traffic',
        source: 'cloud_order',
        sourceId: 'order-traffic',
        bytes: 300,
        startsAt: timestamp,
        expiresAt: null,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ])

    await expect(getEffectiveQuota(db, orgId, new Date('2026-05-06T00:00:00Z'))).resolves.toMatchObject({
      baseQuota: 1000,
      quota: 1600,
      used: 250,
      trafficQuota: 2300,
    })
    await expect(hasQuotaForBytes(db, orgId, 1350)).resolves.toBe(true)
    await expect(hasQuotaForBytes(db, orgId, 1351)).resolves.toBe(false)
  })

  it('ignores inactive and expired storage entitlements', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 0,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values([
      {
        id: nanoid(),
        orgId,
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-revoked',
        bytes: 400,
        startsAt: new Date('2026-05-01T00:00:00Z'),
        expiresAt: null,
        status: 'revoked',
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z'),
      },
      {
        id: nanoid(),
        orgId,
        resourceType: 'storage',
        source: 'cloud_order',
        sourceId: 'order-expired',
        bytes: 400,
        startsAt: new Date('2026-04-01T00:00:00Z'),
        expiresAt: new Date('2026-05-01T00:00:00Z'),
        status: 'active',
        createdAt: new Date('2026-04-01T00:00:00Z'),
        updatedAt: new Date('2026-04-01T00:00:00Z'),
      },
    ])

    await expect(getEffectiveQuota(db, orgId, new Date('2026-05-06T00:00:00Z'))).resolves.toMatchObject({
      baseQuota: 1000,
      quota: 1000,
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
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 101, now)).resolves.toBe(false)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(1000)
  })

  it('uses active traffic entitlements when consuming monthly traffic', async () => {
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
    await db.insert(orgQuotaEntitlements).values({
      id: nanoid(),
      orgId,
      resourceType: 'traffic',
      source: 'cloud_order',
      sourceId: 'order-traffic',
      bytes: 500,
      startsAt: new Date('2026-05-01T00:00:00Z'),
      expiresAt: null,
      status: 'active',
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    })

    await expect(hasTrafficQuotaForBytes(db, orgId, 500, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 500, now)).resolves.toBe(true)
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 101, now)).resolves.toBe(false)

    const rows = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    expect(rows[0].trafficUsed).toBe(1400)
  })

  it('keeps zero traffic quota unlimited when traffic entitlements exist', async () => {
    const { db } = await createTestApp()
    const orgId = nanoid()
    const now = new Date('2026-05-06T00:00:00Z')
    await db.insert(orgQuotas).values({
      id: nanoid(),
      orgId,
      quota: 1000,
      used: 0,
      trafficQuota: 0,
      trafficUsed: 900,
      trafficPeriod: '2026-05',
    })
    await db.insert(orgQuotaEntitlements).values({
      id: nanoid(),
      orgId,
      resourceType: 'traffic',
      source: 'cloud_order',
      sourceId: 'order-traffic-unlimited',
      bytes: 500,
      startsAt: new Date('2026-05-01T00:00:00Z'),
      expiresAt: null,
      status: 'active',
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    })

    await expect(getEffectiveQuota(db, orgId, now)).resolves.toMatchObject({ trafficQuota: 0 })
    await expect(consumeTrafficIfQuotaAllows(db, orgId, 10_000, now)).resolves.toBe(true)
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
})
