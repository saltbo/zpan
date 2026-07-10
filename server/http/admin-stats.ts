import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  getAdminDashboardGrowthStats,
  getAdminDashboardOverviewStats,
  getAdminDashboardRankingStats,
  getAdminDashboardSharingStats,
  getAdminDashboardStorageStats,
  getAdminDashboardTrafficStats,
} from '../usecases/admin-stats'

const dashboardDateSchema = z.string().refine((value) => isValidDashboardDate(value), {
  message: 'Expected yyyy-MM-dd or ISO datetime',
})

const rangeQuerySchema = z.object({
  from: dashboardDateSchema.optional(),
  to: dashboardDateSchema.optional(),
})

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

export const adminStats = new Hono<Env>()
  .get('/overview', requireAdmin, zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardOverviewStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .get('/growth', requireAdmin, requireFeature('analytics'), zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardGrowthStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .get('/storage', requireAdmin, requireFeature('analytics'), zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardStorageStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .get('/traffic', requireAdmin, requireFeature('analytics'), zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardTrafficStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .get('/sharing', requireAdmin, requireFeature('analytics'), zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardSharingStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .get('/ranking', requireAdmin, requireFeature('analytics'), zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardRankingStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
