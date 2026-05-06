import { zValidator } from '@hono/zod-validator'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { organization } from '../db/auth-schema'
import { orgQuotas, quotaGrants } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { currentTrafficPeriod, getEffectiveQuota } from '../services/effective-quota'
import { findPersonalOrg } from '../services/org'

const updateQuotaSchema = z.object({
  quota: z.number().int().positive(),
  trafficQuota: z.number().int().nonnegative().optional(),
})

const adminQuotas = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const period = currentTrafficPeriod()

    await db
      .update(orgQuotas)
      .set({ trafficUsed: 0, trafficPeriod: period })
      .where(sql`${orgQuotas.trafficPeriod} != ${period}`)

    const rows = await db
      .select({
        id: orgQuotas.id,
        orgId: orgQuotas.orgId,
        baseQuota: orgQuotas.quota,
        used: orgQuotas.used,
        trafficQuota: orgQuotas.trafficQuota,
        trafficUsed: orgQuotas.trafficUsed,
        trafficPeriod: orgQuotas.trafficPeriod,
        grantedQuota: sql<number>`COALESCE(SUM(CASE WHEN ${quotaGrants.active} = 1 THEN ${quotaGrants.bytes} ELSE 0 END), 0)`,
        orgName: organization.name,
        orgMetadata: organization.metadata,
      })
      .from(orgQuotas)
      .innerJoin(organization, eq(organization.id, orgQuotas.orgId))
      .leftJoin(quotaGrants, eq(quotaGrants.orgId, orgQuotas.orgId))
      .groupBy(orgQuotas.id, organization.name, organization.metadata)
      .orderBy(organization.name)

    const items = rows.map((r) => {
      const grantedQuota = Number(r.grantedQuota)
      return {
        id: r.id,
        orgId: r.orgId,
        baseQuota: r.baseQuota,
        grantedQuota,
        quota: r.baseQuota === 0 ? 0 : r.baseQuota + grantedQuota,
        used: r.used,
        trafficQuota: r.trafficQuota,
        trafficUsed: r.trafficUsed,
        trafficPeriod: r.trafficPeriod,
        orgName: r.orgName,
        orgType: parseOrgType(r.orgMetadata),
      }
    })

    return c.json({ items, total: items.length })
  })
  .put('/:orgId', zValidator('json', updateQuotaSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const adminOrgId = c.get('orgId')!
    const targetOrgId = c.req.param('orgId')
    const { quota, trafficQuota } = c.req.valid('json')

    const existing = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, targetOrgId))

    if (existing.length > 0) {
      await db
        .update(orgQuotas)
        .set(trafficQuota == null ? { quota } : { quota, trafficQuota })
        .where(eq(orgQuotas.orgId, targetOrgId))
    } else {
      await db.insert(orgQuotas).values({
        id: nanoid(),
        orgId: targetOrgId,
        quota,
        used: 0,
        trafficQuota: trafficQuota ?? 0,
        trafficUsed: 0,
        trafficPeriod: currentTrafficPeriod(),
      })
    }

    await recordActivity(db, {
      orgId: adminOrgId,
      userId,
      action: 'quota_update',
      targetType: 'quota',
      targetId: targetOrgId,
      targetName: targetOrgId,
      metadata: { quota, trafficQuota, targetOrgId },
    })

    return c.json(await getEffectiveQuota(db, targetOrgId))
  })

const userQuotas = new Hono<Env>().use(requireAuth).get('/me', async (c) => {
  const db = c.get('platform').db
  const userId = c.get('userId')!
  const orgId = c.get('orgId') ?? (await findPersonalOrg(db, userId))

  if (!orgId) {
    return c.json({ error: 'No organization found' }, 404)
  }

  const quota = await getEffectiveQuota(db, orgId)
  return c.json(quota)
})

export { adminQuotas, userQuotas }

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  try {
    return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
