import { OpenAPIHono } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { adminOverviewSchema } from '@shared/schemas'
import type { Env } from '../middleware/platform'
import { getAdminOverview } from '../usecases/admin-overview'
import { authRoute, jsonContent } from './openapi'

const route = authRoute(
  { scopes: [AuthorizationScope.SITE_ANALYTICS_READ], siteRole: 'admin' },
  {
    operationId: 'getSiteAnalytics',
    summary: 'Get site analytics',
    tags: ['Site Analytics'],
    method: 'get',
    path: '/',
    responses: { 200: jsonContent(adminOverviewSchema, 'Site analytics') },
  },
)

export const adminOverview = new OpenAPIHono<Env>().openapi(route, async (c) =>
  c.json(await getAdminOverview(c.get('deps')), 200),
)
