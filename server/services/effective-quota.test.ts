import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { orgQuotas } from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import { consumeTrafficIfQuotaAllows, getEffectiveQuota, hasTrafficQuotaForBytes } from './effective-quota.js'

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
      grantedQuota: 0,
      quota: 1000,
      used: 250,
      trafficQuota: 2000,
      trafficUsed: 500,
      trafficPeriod: '2026-05',
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
