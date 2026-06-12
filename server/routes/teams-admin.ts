import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getTeam, listTeams } from '../services/team'

// Admin team management — sibling to /api/admin/users. Lists team orgs and
// exposes one team's detail. Quota entitlements for a team are managed through
// the org-generic endpoints under /api/admin/quotas/:orgId/entitlements.
export const adminTeams = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const items = await listTeams(c.get('platform').db)
    return c.json({ items, total: items.length })
  })
  .get('/:orgId', async (c) => {
    const team = await getTeam(c.get('platform').db, c.req.param('orgId'))
    if (!team) return c.json({ error: 'Team not found' }, 404)
    return c.json(team)
  })
