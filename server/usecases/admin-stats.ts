import type {
  AdminDashboardGrowthStats,
  AdminDashboardOverviewStats,
  AdminDashboardRankingStats,
  AdminDashboardSharingStats,
  AdminDashboardStorageStats,
  AdminDashboardTrafficStats,
} from '@shared/types'
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
const DAY_MS = 86_400_000

export function normalizeStatsRange(input: AdminStatsRangeInput, now = new Date()): AdminStatsDateRange {
  const to = input.to ?? endOfDay(now)
  const from = input.from ?? startOfDay(daysAgo(to, 29))
  if (from > to) throw badRequest('from must be before to', 'INVALID_TIME_RANGE')
  if (inclusiveDayCount(from, to) > MAX_DASHBOARD_RANGE_DAYS) {
    throw badRequest(`time range cannot exceed ${MAX_DASHBOARD_RANGE_DAYS} days`, 'TIME_RANGE_TOO_LARGE')
  }
  return { from, to, timeZone: input.timeZone ?? 'UTC' }
}

export function getAdminDashboardOverviewStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardOverviewStats> {
  return deps.adminStats.getDashboardOverviewStats(now, normalizeStatsRange(input, now))
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

export function getAdminDashboardRankingStats(
  deps: AdminStatsDeps,
  input: AdminStatsRangeInput,
  now = new Date(),
): Promise<AdminDashboardRankingStats> {
  return deps.adminStats.getDashboardRankingStats(now, normalizeStatsRange(input, now))
}

function daysAgo(now: Date, days: number): Date {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function endOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
}

function inclusiveDayCount(from: Date, to: Date): number {
  const fromDay = startOfDay(from).getTime()
  const toDay = startOfDay(to).getTime()
  return Math.floor((toDay - fromDay) / DAY_MS) + 1
}
