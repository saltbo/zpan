import type { activityEvents } from '../../db/schema'

export const ADMIN_STATS_FACT_ACTIONS = [
  'stats_user_signup',
  'stats_share_created',
  'stats_background_job_finished',
  'stats_remote_download_finished',
] as const

export type AdminStatsFactAction = (typeof ADMIN_STATS_FACT_ACTIONS)[number]

export function adminStatsFactValues(input: {
  action: AdminStatsFactAction
  sourceId: string
  targetId?: string
  orgId: string
  targetType: string
  occurredAt: Date
  metadata: Record<string, unknown>
}): typeof activityEvents.$inferInsert {
  const targetId = input.targetId ?? input.sourceId
  return {
    id: `stats:${input.action}:${input.sourceId}`,
    orgId: input.orgId,
    userId: null,
    actorType: 'system',
    actorRef: 'admin-stats',
    action: input.action,
    targetType: input.targetType,
    targetId,
    targetName: targetId,
    metadata: JSON.stringify({ ...input.metadata, statsQuality: 'exact' }),
    createdAt: input.occurredAt,
  }
}
