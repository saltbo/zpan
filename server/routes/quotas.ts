import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { organization } from '../db/auth-schema'
import { orgQuotas } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { getEffectiveQuota } from '../services/effective-quota'
import { findPersonalOrg } from '../services/org'

const updateQuotaSchema = z.object({
  quota: z.number().int().positive(),
})

const adminQuotas = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const rows = await db
      .select({
        id: orgQuotas.id,
        orgId: orgQuotas.orgId,
        quota: orgQuotas.quota,
        used: orgQuotas.used,
        orgName: organization.name,
        orgMetadata: organization.metadata,
      })
      .from(orgQuotas)
      .innerJoin(organization, eq(organization.id, orgQuotas.orgId))
      .orderBy(organization.name)

    const items = rows.map((r) => ({
      id: r.id,
      orgId: r.orgId,
      quota: r.quota,
      used: r.used,
      orgName: r.orgName,
      orgType: parseOrgType(r.orgMetadata),
    }))

    return c.json({ items, total: items.length })
  })
  .put('/:orgId', zValidator('json', updateQuotaSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const adminOrgId = c.get('orgId')!
    const targetOrgId = c.req.param('orgId')
    const { quota } = c.req.valid('json')

    const existing = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, targetOrgId))

    if (existing.length > 0) {
      await db.update(orgQuotas).set({ quota }).where(eq(orgQuotas.orgId, targetOrgId))
    } else {
      await db.insert(orgQuotas).values({ id: nanoid(), orgId: targetOrgId, quota, used: 0 })
    }

    await recordActivity(db, {
      orgId: adminOrgId,
      userId,
      action: 'quota_update',
      targetType: 'quota',
      targetId: targetOrgId,
      targetName: targetOrgId,
      metadata: { quota, targetOrgId },
    })

    return c.json({ orgId: targetOrgId, quota })
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
