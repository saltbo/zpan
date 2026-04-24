import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { organization } from '../db/auth-schema'
import { orgQuotas } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { findPersonalOrg } from '../services/org'

const updateQuotaSchema = z.object({
  quota: z.number().min(0),
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
  .put('/:orgId', requireFeature('team_quotas'), zValidator('json', updateQuotaSchema), async (c) => {
    const db = c.get('platform').db
    const orgId = c.req.param('orgId')
    const { quota } = c.req.valid('json')

    const existing = await db.select({ id: orgQuotas.id }).from(orgQuotas).where(eq(orgQuotas.orgId, orgId))

    if (existing.length > 0) {
      await db.update(orgQuotas).set({ quota }).where(eq(orgQuotas.orgId, orgId))
    } else {
      await db.insert(orgQuotas).values({ id: nanoid(), orgId, quota, used: 0 })
    }

    return c.json({ orgId, quota })
  })

const userQuotas = new Hono<Env>().use(requireAuth).get('/me', async (c) => {
  const db = c.get('platform').db
  const userId = c.get('userId')!
  const orgId = c.get('orgId') ?? (await findPersonalOrg(db, userId))

  if (!orgId) {
    return c.json({ error: 'No organization found' }, 404)
  }

  const rows = await db
    .select({ quota: orgQuotas.quota, used: orgQuotas.used })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))

  const quotaRow = rows[0] ?? { quota: 0, used: 0 }
  return c.json({ orgId, quota: quotaRow.quota, used: quotaRow.used })
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
