import { Hono } from 'hono'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { emptyTrash } from '../usecases/trash'

const app = new Hono<Env>().use(requireAuth).delete('/', requireTeamRole('editor'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'No active organization' }, 400)
  const result = await emptyTrash(c.get('deps'), { orgId, userId: c.get('userId')! })
  return c.json({ purged: result.purged })
})

export default app
