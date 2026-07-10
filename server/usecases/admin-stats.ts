import type {
  AdminDashboardGrowthStats,
  AdminDashboardOperationsStats,
  AdminDashboardOverviewStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
} from '@shared/types'
import { addCalendarDays, localDateStart, statsDayKey } from '../domain/admin-stats-time'
import { type AdminStatsDateRange, type AdminStatsRepo, badRequest } from './ports'

export type AdminStatsDeps = {
  adminStats: AdminStatsRepo
}

export interface AdminStatsRangeInput {
  from?: Date
  to?: Date
  timeZone?: string
}

const MAX_DASHBOARD_RANGE_DAYS = 366
export function normalizeStatsRange(input: AdminStatsRangeInput, now = new Date()): AdminStatsDateRange {
  const timeZone = input.timeZone ?? 'UTC'
  const today = statsDayKey(now, timeZone)
  const to = input.to ?? new Date(localDateStart(addCalendarDays(today, 1), timeZone).getTime() - 1)
  const from = input.from ?? localDateStart(addCalendarDays(statsDayKey(to, timeZone), -29), timeZone)
  if (from > to) throw badRequest('from must be before to', 'INVALID_TIME_RANGE')
  if (calendarDayCount(from, to, timeZone) > MAX_DASHBOARD_RANGE_DAYS) {
    throw badRequest(`time range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days`, 'TIME_RANGE_TOO_LARGE')
  }
  return { from, to, timeZone }
}

export function getAdminDashboardOverviewStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardOverviewStats> {
  return deps.adminStats.getDashboardOverviewStats(now, normalizeStatsRange(input, now))
}

export function getAdminDashboardOperationsStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardOperationsStats> {
  return deps.adminStats.getDashboardOperationsStats(now, normalizeStatsRange(input, now))
}

export function getAdminDashboardGrowthStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardGrowthStats> {
  return deps.adminStats.getDashboardGrowthStats(now, normalizeStatsRange(input, now))
}

export function getAdminDashboardStorageStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardStorageStats> {
  return deps.adminStats.getDashboardStorageStats(now, normalizeStatsRange(input, now))
}

export function getAdminDashboardTrafficStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardTrafficStats> {
  return deps.adminStats.getDashboardTrafficStats(now, normalizeStatsRange(input, now))
}

export function getAdminDashboardSharingStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardSharingStats> {
  return deps.adminStats.getDashboardSharingStats(now, normalizeStatsRange(input, now))
}

function calendarDayCount(from: Date, to: Date, timeZone: string): number {
  const fromDay = Date.parse(`${statsDayKey(from, timeZone)}T00:00:00.000Z`)
  const toDay = Date.parse(`${statsDayKey(to, timeZone)}T00:00:00.000Z`)
  return Math.floor((toDay - fromDay) / 86_400_000) + 1
}
