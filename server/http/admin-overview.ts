import type { AdminOverview } from '@shared/types'
import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getAdminOverview } from '../usecases/admin-overview'

export const adminOverview = new Hono<Env>().get('/', requireAdmin, async (c) => {
  return c.json((await getAdminOverview(c.get('deps'))) satisfies AdminOverview, 200)
})
