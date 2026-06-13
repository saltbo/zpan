import { Hono } from 'hono'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { purgeRecursively } from '../usecases/purge'

const app = new Hono<Env>().use(requireAuth).delete('/', requireTeamRole('editor'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'No active organization' }, 400)
  const userId = c.get('userId')!
  const roots = await c.get('deps').matter.listTrashedRoots(orgId)
  let purgedCount = 0
  for (const root of roots) {
    const ms = await c.get('deps').matter.collectForPurge(orgId, root.id)
    if (!ms) continue
    purgedCount += await purgeRecursively(c.get('deps'), orgId, ms)
  }
  if (purgedCount > 0) {
    await c.get('deps').activity.record({
      orgId,
      userId,
      action: 'trash_empty',
      targetType: 'file',
      targetName: `${purgedCount} items`,
      metadata: { count: purgedCount },
    })
  }
  return c.json({ purged: purgedCount })
})

export default app
