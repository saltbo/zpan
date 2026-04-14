import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listActivities } from '../services/activity'
import { getMemberRole, isPersonalOrg } from '../services/org'

const activityQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/:teamId/activity', zValidator('query', activityQuerySchema), async (c) => {
    const userId = c.get('userId')!
    const teamId = c.req.param('teamId')
    const db = c.get('platform').db

    const role = await getMemberRole(db, teamId, userId)
    if (role === null && !(await isPersonalOrg(db, teamId))) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const { page: pageStr, pageSize: pageSizeStr } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const result = await listActivities(db, teamId, { page, pageSize })
    return c.json({ ...result, page, pageSize })
  })

export default app
