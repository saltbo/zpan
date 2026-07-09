import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  getAdminCoreStats,
  getAdminDashboardGrowthStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardRankingStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
  getAdminDetailedStats,
} from '../usecases/admin-stats'
import { errorResponse, jsonContent } from './openapi'

const coreStatsSchema = z
  .object({
    generatedAt: z.string(),
    users: z.object({
      total: z.number().int(),
      admins: z.number().int(),
      activeLast30Days: z.number().int(),
      newLast7Days: z.number().int(),
    }),
    spaces: z.object({
      total: z.number().int(),
      personal: z.number().int(),
      team: z.number().int(),
      newLast30Days: z.number().int(),
    }),
    storage: z.object({
      usedBytes: z.number().int(),
      quotaBytes: z.number().int(),
      quotaUtilization: z.number(),
      capacityBytes: z.number().int(),
      backendCount: z.number().int(),
      activeBackendCount: z.number().int(),
    }),
    traffic: z.object({
      usedBytes: z.number().int(),
      quotaBytes: z.number().int(),
      utilization: z.number(),
      period: z.string(),
    }),
    sharing: z.object({
      totalShares: z.number().int(),
      activeShares: z.number().int(),
      views: z.number().int(),
      downloads: z.number().int(),
    }),
    operations: z.object({
      pendingInvitations: z.number().int(),
      failedBackgroundJobs: z.number().int(),
      offlineDownloaders: z.number().int(),
      runningDownloadTasks: z.number().int(),
    }),
  })
  .openapi('AdminCoreStats')

const statusCountSchema = z.object({ status: z.string(), count: z.number().int() })

const detailedStatsSchema = z
  .object({
    generatedAt: z.string(),
    periodDays: z.number().int(),
    trends: z.array(
      z.object({
        date: z.string(),
        signups: z.number().int(),
        activeUsers: z.number().int(),
        shareViews: z.number().int(),
        shareDownloads: z.number().int(),
        remoteTasks: z.number().int(),
        failedJobs: z.number().int(),
      }),
    ),
    usageBySpace: z.array(
      z.object({
        orgId: z.string(),
        orgName: z.string(),
        orgType: z.string(),
        usedBytes: z.number().int(),
        quotaBytes: z.number().int(),
        utilization: z.number(),
      }),
    ),
    storageByType: z.array(z.object({ type: z.string(), bytes: z.number().int(), files: z.number().int() })),
    topShares: z.array(
      z.object({
        id: z.string(),
        token: z.string(),
        name: z.string(),
        creatorId: z.string(),
        creatorName: z.string(),
        views: z.number().int(),
        downloads: z.number().int(),
        status: z.string(),
      }),
    ),
    sharing: z.object({
      expiredShares: z.number().int(),
      revokedShares: z.number().int(),
      downloadLimitHitShares: z.number().int(),
      conversionRate: z.number(),
    }),
    remoteDownloads: z.object({
      total: z.number().int(),
      completed: z.number().int(),
      failed: z.number().int(),
      running: z.number().int(),
      successRate: z.number(),
      byStatus: z.array(statusCountSchema),
      failureReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
      byDownloader: z.array(
        z.object({
          downloaderId: z.string(),
          name: z.string(),
          status: z.string(),
          tasks: z.number().int(),
          failedTasks: z.number().int(),
          lastHeartbeatAt: z.string().nullable(),
        }),
      ),
    }),
    reliability: z.object({
      backgroundJobs: z.object({
        total: z.number().int(),
        failed: z.number().int(),
        failureRate: z.number(),
        byStatus: z.array(statusCountSchema),
        failures: z.array(
          z.object({ id: z.string(), type: z.string(), errorMessage: z.string().nullable(), createdAt: z.string() }),
        ),
      }),
      cloudTrafficReports: z.object({ pending: z.number().int(), failed: z.number().int() }),
      license: z.object({
        active: z.boolean(),
        edition: z.string().nullable(),
        lastRefreshAt: z.string().nullable(),
        lastRefreshError: z.string().nullable(),
      }),
    }),
  })
  .openapi('AdminDetailedStats')

const detailsQuerySchema = z.object({
  periodDays: z.coerce.number().int().min(7).max(90).default(30),
})

const dashboardDateSchema = z.string().refine((value) => isValidDashboardDate(value), {
  message: 'Expected yyyy-MM-dd or ISO datetime',
})

const rangeQuerySchema = z.object({
  from: dashboardDateSchema.optional(),
  to: dashboardDateSchema.optional(),
})

const statsRangeFields = {
  generatedAt: z.string(),
  from: z.string(),
  to: z.string(),
}

const deltaSchema = z.object({
  value: z.number(),
  previousValue: z.number(),
  changePercent: z.number(),
})

const topShareWithPercentSchema = z.object({
  id: z.string(),
  token: z.string(),
  name: z.string(),
  creatorId: z.string(),
  creatorName: z.string(),
  views: z.number(),
  downloads: z.number(),
  status: z.string(),
  viewPercent: z.number(),
  downloadPercent: z.number(),
})

const usageBySpaceSchema = z.object({
  orgId: z.string(),
  orgName: z.string(),
  orgType: z.string(),
  usedBytes: z.number(),
  quotaBytes: z.number(),
  utilization: z.number(),
})

const storageByTypeSchema = z.object({
  type: z.string(),
  bytes: z.number(),
  files: z.number(),
})

const namedPercentValueSchema = z.object({
  name: z.string(),
  value: z.number(),
  percent: z.number(),
})

const namedBytesBreakdownSchema = z.object({
  name: z.string(),
  bytes: z.number(),
  files: z.number(),
  percent: z.number(),
})

const dashboardOverviewStatsSchema = z
  .object({
    ...statsRangeFields,
    totals: z.object({
      users: z.number(),
      newUsers: deltaSchema,
      activeUsers: deltaSchema,
      storageUsedBytes: z.number(),
      storageQuotaBytes: z.number(),
      trafficBytes: deltaSchema,
      uploadBytes: deltaSchema,
      downloadBytes: deltaSchema,
      activeShares: z.number(),
      shareViews: deltaSchema,
      shareDownloads: deltaSchema,
    }),
    trends: z.array(
      z.object({
        date: z.string(),
        newUsers: z.number(),
        activeUsers: z.number(),
        storageUsedBytes: z.number(),
        uploadBytes: z.number(),
        downloadBytes: z.number(),
      }),
    ),
  })
  .openapi('AdminDashboardOverviewStats')

const dashboardGrowthStatsSchema = z
  .object({
    ...statsRangeFields,
    summary: z.object({
      totalUsers: z.number(),
      newUsers: deltaSchema,
      activeUsers: deltaSchema,
      verifiedUsers: z.number(),
      bannedUsers: z.number(),
      silentUsers: z.number(),
    }),
    userScaleTrend: z.array(z.object({ date: z.string(), newUsers: z.number(), totalUsers: z.number() })),
    activeUserTrend: z.array(z.object({ date: z.string(), dau: z.number(), wau: z.number(), mau: z.number() })),
    userStatus: z.array(namedPercentValueSchema),
    registrationSources: z.array(namedPercentValueSchema),
  })
  .openapi('AdminDashboardGrowthStats')

const dashboardStorageStatsSchema = z
  .object({
    ...statsRangeFields,
    summary: z.object({
      storageUsedBytes: z.number(),
      quotaBytes: z.number(),
      fileCount: z.number(),
      newFiles: deltaSchema,
      newBytes: deltaSchema,
      coldFileBytes: z.number(),
    }),
    storageTrend: z.array(
      z.object({ date: z.string(), usedBytes: z.number(), newBytes: z.number(), newFiles: z.number() }),
    ),
    typeBreakdown: z.array(storageByTypeSchema.extend({ percent: z.number() })),
    sizeBreakdown: z.array(namedBytesBreakdownSchema),
    ageBreakdown: z.array(namedBytesBreakdownSchema),
  })
  .openapi('AdminDashboardStorageStats')

const dashboardTrafficStatsSchema = z
  .object({
    ...statsRangeFields,
    summary: z.object({
      totalBytes: deltaSchema,
      requestCount: deltaSchema,
      issuedDownloads: z.number(),
      blockedDownloads: z.number(),
      issueRate: z.number(),
      peakDailyBytes: z.number(),
    }),
    trafficTrend: z.array(
      z.object({ date: z.string(), uploadBytes: z.number(), downloadBytes: z.number(), requests: z.number() }),
    ),
    sourceBreakdown: z.array(
      z.object({ name: z.string(), bytes: z.number(), requests: z.number(), percent: z.number() }),
    ),
    issueStatus: z.array(z.object({ status: z.string(), count: z.number(), percent: z.number() })),
    bandwidthTrend: z.array(z.object({ date: z.string(), bytes: z.number() })),
    successTrend: z.array(
      z.object({ date: z.string(), uploadSuccessRate: z.number(), downloadSuccessRate: z.number() }),
    ),
    failureReasons: z.array(namedPercentValueSchema),
  })
  .openapi('AdminDashboardTrafficStats')

const dashboardSharingStatsSchema = z
  .object({
    ...statsRangeFields,
    summary: z.object({
      activeShares: z.number(),
      createdShares: deltaSchema,
      views: deltaSchema,
      downloads: deltaSchema,
      saves: deltaSchema,
      downloadConversionRate: z.number(),
    }),
    funnel: z.array(namedPercentValueSchema),
    trend: z.array(z.object({ date: z.string(), views: z.number(), downloads: z.number(), saves: z.number() })),
    typeBreakdown: z.array(namedPercentValueSchema),
    sourceBreakdown: z.array(namedPercentValueSchema),
    topShares: z.array(topShareWithPercentSchema),
  })
  .openapi('AdminDashboardSharingStats')

const dashboardRankingStatsSchema = z
  .object({
    ...statsRangeFields,
    topShares: z.array(topShareWithPercentSchema),
    topSpaces: z.array(usageBySpaceSchema),
    storageByType: z.array(storageByTypeSchema),
  })
  .openapi('AdminDashboardRankingStats')

function parseRange(query: z.infer<typeof rangeQuerySchema>): { from?: Date; to?: Date } {
  return {
    from: query.from ? parseDashboardDate(query.from, 'start') : undefined,
    to: query.to ? parseDashboardDate(query.to, 'end') : undefined,
  }
}

function isValidDashboardDate(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
  }
  return !Number.isNaN(Date.parse(value))
}

function parseDashboardDate(value: string, boundary: 'start' | 'end'): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`)
  }
  return new Date(value)
}

const coreRoute = createRoute({
  operationId: 'getAdminCoreStats',
  summary: 'Get admin dashboard core stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/core',
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(coreStatsSchema, 'Admin core stats'),
    401: errorResponse('Unauthorized'),
  },
})

const detailsRoute = createRoute({
  operationId: 'getAdminDetailedStats',
  summary: 'Get admin dashboard detailed stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/details',
  middleware: [requireAdmin, requireFeature('analytics')] as const,
  request: { query: detailsQuerySchema },
  responses: {
    200: jsonContent(detailedStatsSchema, 'Admin detailed stats'),
    402: errorResponse('Feature not available'),
  },
})

const overviewRoute = createRoute({
  operationId: 'getAdminDashboardOverviewStats',
  summary: 'Get admin dashboard overview stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/overview',
  middleware: [requireAdmin] as const,
  request: { query: rangeQuerySchema },
  responses: {
    200: jsonContent(dashboardOverviewStatsSchema, 'Admin dashboard overview stats'),
    400: errorResponse('Invalid query'),
    401: errorResponse('Unauthorized'),
  },
})

const growthRoute = createRoute({
  operationId: 'getAdminDashboardGrowthStats',
  summary: 'Get admin dashboard growth stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/growth',
  middleware: [requireAdmin, requireFeature('analytics')] as const,
  request: { query: rangeQuerySchema },
  responses: {
    200: jsonContent(dashboardGrowthStatsSchema, 'Admin dashboard growth stats'),
    400: errorResponse('Invalid query'),
    402: errorResponse('Feature not available'),
  },
})

const storageRoute = createRoute({
  operationId: 'getAdminDashboardStorageStats',
  summary: 'Get admin dashboard storage stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/storage',
  middleware: [requireAdmin, requireFeature('analytics')] as const,
  request: { query: rangeQuerySchema },
  responses: {
    200: jsonContent(dashboardStorageStatsSchema, 'Admin dashboard storage stats'),
    400: errorResponse('Invalid query'),
    402: errorResponse('Feature not available'),
  },
})

const trafficRoute = createRoute({
  operationId: 'getAdminDashboardTrafficStats',
  summary: 'Get admin dashboard traffic stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/traffic',
  middleware: [requireAdmin, requireFeature('analytics')] as const,
  request: { query: rangeQuerySchema },
  responses: {
    200: jsonContent(dashboardTrafficStatsSchema, 'Admin dashboard traffic stats'),
    400: errorResponse('Invalid query'),
    402: errorResponse('Feature not available'),
  },
})

const sharingRoute = createRoute({
  operationId: 'getAdminDashboardSharingStats',
  summary: 'Get admin dashboard sharing stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/sharing',
  middleware: [requireAdmin, requireFeature('analytics')] as const,
  request: { query: rangeQuerySchema },
  responses: {
    200: jsonContent(dashboardSharingStatsSchema, 'Admin dashboard sharing stats'),
    400: errorResponse('Invalid query'),
    402: errorResponse('Feature not available'),
  },
})

const rankingRoute = createRoute({
  operationId: 'getAdminDashboardRankingStats',
  summary: 'Get admin dashboard ranking stats',
  tags: ['Admin Stats'],
  method: 'get',
  path: '/ranking',
  middleware: [requireAdmin, requireFeature('analytics')] as const,
  request: { query: rangeQuerySchema },
  responses: {
    200: jsonContent(dashboardRankingStatsSchema, 'Admin dashboard ranking stats'),
    400: errorResponse('Invalid query'),
    402: errorResponse('Feature not available'),
  },
})

export const adminStats = new OpenAPIHono<Env>()
  .openapi(coreRoute, async (c) => c.json(await getAdminCoreStats(c.get('deps')), 200))
  .openapi(detailsRoute, async (c) => {
    const { periodDays } = c.req.valid('query')
    return c.json(await getAdminDetailedStats(c.get('deps'), { periodDays }), 200)
  })
  .openapi(overviewRoute, async (c) =>
    c.json(await getAdminDashboardOverviewStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
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
  .openapi(rankingRoute, async (c) =>
    c.json(await getAdminDashboardRankingStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
