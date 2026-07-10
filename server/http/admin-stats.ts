import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { addCalendarDays, localDateStart } from '../domain/admin-stats-time'
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

const dashboardDateSchema = z
  .string()
  .refine(isValidDashboardDate, { message: 'Expected valid yyyy-MM-dd or ISO datetime with offset' })

const rangeQuerySchema = z.object({
  from: dashboardDateSchema.optional(),
  to: dashboardDateSchema.optional(),
  timeZone: z.string().max(64).refine(isValidTimeZone, 'Invalid IANA time zone').optional(),
})

function parseRange(query: z.infer<typeof rangeQuerySchema>): { from?: Date; to?: Date; timeZone?: string } {
  const timeZone = query.timeZone ?? 'UTC'
  return {
    from: query.from ? parseDashboardDate(query.from, 'start', timeZone) : undefined,
    to: query.to ? parseDashboardDate(query.to, 'end', timeZone) : undefined,
    timeZone,
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function isValidDashboardDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return z.string().datetime({ offset: true }).safeParse(value).success
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

function parseDashboardDate(value: string, boundary: 'start' | 'end', timeZone: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    if (boundary === 'start') return localDateStart(value, timeZone)
    return new Date(localDateStart(addCalendarDays(value, 1), timeZone).getTime() - 1)
  }
  return new Date(value)
}

export const adminStats = new Hono<Env>()
  .get('/overview', requireAdmin, zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardOverviewStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
  )
  .get('/operations', requireAdmin, requireFeature('analytics'), zValidator('query', rangeQuerySchema), async (c) =>
    c.json(await getAdminDashboardOperationsStats(c.get('deps'), parseRange(c.req.valid('query'))), 200),
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
