import { AuthorizationScope } from '@shared/authorization'
import { adminOverviewSchema } from '@shared/schemas'
import { getAdminOverview } from '../usecases/admin-overview'
import { authRoute, jsonContent } from './openapi'
import { createRouter } from './router'

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

export const adminOverview = createRouter().openapi(route, async (c) =>
  c.json(await getAdminOverview(c.get('deps')), 200),
)
