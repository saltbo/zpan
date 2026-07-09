import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { getAdminCoreStats, getAdminDetailedStats } from '../usecases/admin-stats'
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

export const adminStats = new OpenAPIHono<Env>()
  .openapi(coreRoute, async (c) => c.json(await getAdminCoreStats(c.get('deps')), 200))
  .openapi(detailsRoute, async (c) => {
    const { periodDays } = c.req.valid('query')
    return c.json(await getAdminDetailedStats(c.get('deps'), { periodDays }), 200)
  })
