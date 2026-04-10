import { zValidator } from '@hono/zod-validator'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { findPersonalOrg } from '../services/org'

const updateQuotaSchema = z.object({
  quota: z.number().min(0),
})

const adminQuotas = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const rows = await db.all<{
      id: string
      orgId: string
      quota: number
      used: number
      orgName: string
      orgMetadata: string | null
    }>(sql`
      SELECT q.id, q.org_id AS orgId, q.quota, q.used,
             o.name AS orgName, o.metadata AS orgMetadata
      FROM org_quotas q
      INNER JOIN organization o ON o.id = q.org_id
      ORDER BY o.name
    `)

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
    const orgId = c.req.param('orgId')
    const { quota } = c.req.valid('json')

    const existing = await db.all<{ id: string }>(sql`SELECT id FROM org_quotas WHERE org_id = ${orgId}`)

    if (existing.length > 0) {
      await db.run(sql`UPDATE org_quotas SET quota = ${quota} WHERE org_id = ${orgId}`)
    } else {
      await db.run(sql`INSERT INTO org_quotas (id, org_id, quota, used) VALUES (${nanoid()}, ${orgId}, ${quota}, 0)`)
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

  const rows = await db.all<{ quota: number; used: number }>(
    sql`SELECT quota, used FROM org_quotas WHERE org_id = ${orgId}`,
  )

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
