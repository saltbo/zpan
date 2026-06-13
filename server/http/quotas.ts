import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { organization } from '../db/auth-schema'
import { orgQuotas } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'

// Quota overview across all orgs (personal + team), used by the admin dashboard.
// Per-team entitlement management lives under /api/admin/teams.
const adminQuotas = new Hono<Env>().use(requireAdmin).get('/', async (c) => {
  const db = c.get('platform').db
  const now = new Date()

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

  const quotas = await c.get('deps').quota.getEffectiveQuotasByOrg(
    rows.map((r) => r.orgId),
    now,
  )

  const items = rows.map((r) => ({
    id: r.id,
    ...quotas.get(r.orgId)!,
    orgName: r.orgName,
    orgType: parseOrgType(r.orgMetadata),
  }))

  return c.json({ items, total: items.length })
})

const userQuotas = new Hono<Env>().use(requireAuth).get('/me', async (c) => {
  const db = c.get('platform').db
  const userId = c.get('userId')!
  const orgId = c.get('orgId') ?? (await c.get('deps').org.findPersonalOrg(userId))

  if (!orgId) {
    return c.json({ error: 'No organization found' }, 404)
  }

  const quota = await c.get('deps').quota.getEffectiveQuota(orgId)
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
