import { Hono } from 'hono'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { collectForPurge, listTrashedRoots } from '../services/matter'
import { purgeRecursively } from '../services/purge'

const app = new Hono<Env>().use(requireAuth).delete('/', requireTeamRole('editor'), async (c) => {
  const orgId = c.get('orgId')
  if (!orgId) return c.json({ error: 'No active organization' }, 400)
  const userId = c.get('userId')!
  const db = c.get('platform').db
  const roots = await listTrashedRoots(db, orgId)
  let purgedCount = 0
  for (const root of roots) {
    const ms = await collectForPurge(db, orgId, root.id)
    if (!ms) continue
    purgedCount += await purgeRecursively(db, orgId, ms)
  }
  if (purgedCount > 0) {
    await recordActivity(db, {
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
