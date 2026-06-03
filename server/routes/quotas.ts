import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { organization } from '../db/auth-schema'
import { orgQuotas } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { currentTrafficPeriod, getEffectiveQuota } from '../services/effective-quota'
import { findPersonalOrg } from '../services/org'

const adminQuotas = new Hono<Env>().use(requireAdmin).get('/', async (c) => {
  const db = c.get('platform').db
  const period = currentTrafficPeriod()
  const now = new Date()

  await db
    .update(orgQuotas)
    .set({ trafficUsed: 0, trafficPeriod: period })
    .where(sql`${orgQuotas.trafficPeriod} != ${period}`)

  const rows = await db
    .select({
      id: orgQuotas.id,
      orgId: orgQuotas.orgId,
      orgName: organization.name,
      orgMetadata: organization.metadata,
    })
    .from(orgQuotas)
    .innerJoin(organization, eq(organization.id, orgQuotas.orgId))
    .orderBy(organization.name)

  const items = await Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      ...(await getEffectiveQuota(db, r.orgId, now)),
      orgName: r.orgName,
      orgType: parseOrgType(r.orgMetadata),
    })),
  )

  return c.json({ items, total: items.length })
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
