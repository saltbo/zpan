import { Hono } from 'hono'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getUserQuota, listQuotaOverview } from '../usecases/quota'

// Quota overview across all orgs (personal + team), used by the admin dashboard.
// Per-team entitlement management lives under /api/admin/teams.
const adminQuotas = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => c.json(await listQuotaOverview(c.get('deps'))))

const userQuotas = new Hono<Env>().use(requireAuth).get('/me', async (c) => {
  const quota = await getUserQuota(c.get('deps'), { userId: c.get('userId')!, orgId: c.get('orgId') ?? undefined })
  if (!quota) return c.json({ error: 'No organization found' }, 404)
  return c.json(quota)
})

export { adminQuotas, userQuotas }
