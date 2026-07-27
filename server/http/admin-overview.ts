import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { adminOverviewSchema } from '@shared/schemas'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getAdminOverview } from '../usecases/admin-overview'
import { jsonContent } from './openapi'

const route = createRoute({
  operationId: 'getSiteAnalytics',
  summary: 'Get site analytics',
  tags: ['Site Analytics'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(adminOverviewSchema, 'Site analytics') },
})

export const adminOverview = new OpenAPIHono<Env>().openapi(route, async (c) =>
  c.json(await getAdminOverview(c.get('deps')), 200),
)
