import { OpenAPIHono, z } from '@hono/zod-openapi'
import {
  adminAnalyticsGrowthSchema,
  adminAnalyticsOperationsSchema,
  adminAnalyticsOverviewSchema,
  adminAnalyticsSharingSchema,
  adminAnalyticsStorageSchema,
  adminAnalyticsTrafficSchema,
} from '@shared/schemas'
import { addCalendarDays, utcDateStart } from '../domain/admin-stats-time'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  getAdminDashboardGrowthStats,
  getAdminDashboardOperationsStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '../usecases/admin-stats'
import { authRoute, jsonContent } from './openapi'

const dashboardDateSchema = z
  .string()
  .refine(isValidDashboardDate, { message: 'Expected valid yyyy-MM-dd or ISO datetime with offset' })

const rangeQuerySchema = z.object({
  from: dashboardDateSchema.optional(),
  to: dashboardDateSchema.optional(),
  timeZone: z.literal('UTC').optional(),
})

function parseRange(query: z.infer<typeof rangeQuerySchema>): { from?: Date; to?: Date; timeZone: 'UTC' } {
  return {
    from: query.from ? parseDashboardDate(query.from, 'start') : undefined,
    to: query.to ? parseDashboardDate(query.to, 'end') : undefined,
    timeZone: 'UTC',
  }
}

function isValidDashboardDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return z.string().datetime({ offset: true }).safeParse(value).success
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

function parseDashboardDate(value: string, boundary: 'start' | 'end'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (boundary === 'start') return utcDateStart(value)
    return new Date(utcDateStart(addCalendarDays(value, 1)).getTime() - 1)
  }
  return new Date(value)
}

function analyticsRoute(
  operationId: string,
  summary: string,
  path: string,
  schema: Parameters<typeof jsonContent>[0],
  gated = true,
) {
  return authRoute(
    { access: 'admin' },
    {
      operationId,
      summary,
      tags: ['Site Analytics'],
      method: 'get',
      path,
      middleware: (gated ? [requireAdmin, requireFeature('analytics')] : [requireAdmin]) as [
        typeof requireAdmin,
        ...Array<ReturnType<typeof requireFeature>>,
      ],
      request: { query: rangeQuerySchema },
      responses: { 200: jsonContent(schema, summary) },
    },
  )
}

const overviewRoute = analyticsRoute(
  'getAdminAnalyticsOverview',
  'Get analytics overview',
  '/overview',
  adminAnalyticsOverviewSchema,
  false,
)
const operationsRoute = analyticsRoute(
  'getAdminAnalyticsOperations',
  'Get operations analytics',
  '/operations',
  adminAnalyticsOperationsSchema,
)
const growthRoute = analyticsRoute(
  'getAdminAnalyticsGrowth',
  'Get growth analytics',
  '/growth',
  adminAnalyticsGrowthSchema,
)
const storageRoute = analyticsRoute(
  'getAdminAnalyticsStorage',
  'Get storage analytics',
  '/storage',
  adminAnalyticsStorageSchema,
)
const trafficRoute = analyticsRoute(
  'getAdminAnalyticsTraffic',
  'Get traffic analytics',
  '/traffic',
  adminAnalyticsTrafficSchema,
)
const sharingRoute = analyticsRoute(
  'getAdminAnalyticsSharing',
  'Get sharing analytics',
  '/sharing',
  adminAnalyticsSharingSchema,
)

export const adminStats = new OpenAPIHono<Env>()
  .openapi(overviewRoute, async (c) =>
    c.json(await getAdminDashboardOverviewStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .openapi(operationsRoute, async (c) =>
    c.json(await getAdminDashboardOperationsStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .openapi(growthRoute, async (c) =>
    c.json(await getAdminDashboardGrowthStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .openapi(storageRoute, async (c) =>
    c.json(await getAdminDashboardStorageStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .openapi(trafficRoute, async (c) =>
    c.json(await getAdminDashboardTrafficStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .openapi(sharingRoute, async (c) =>
    c.json(await getAdminDashboardSharingStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
