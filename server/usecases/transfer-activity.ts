import type { ActivityRepo } from './ports'

type ActivityWriter = Pick<ActivityRepo, 'record'>

export function createTrafficEventId(): string {
  return `traffic_${crypto.randomUUID()}`
}

export function recordDownloadIssued(
  activity: ActivityWriter,
  input: {
    orgId: string
    userId?: string | null
    actorType?: 'user' | 'anonymous' | 'system' | 'downloader'
    action: 'share_download' | 'object_download' | 'image_hosting_download' | 'webdav_download'
    targetType: string
    targetId: string
    targetName: string
    source: string
    bytes: number
    trafficEventId: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  return activity.record({
    orgId: input.orgId,
    userId: input.userId,
    actorType: input.actorType,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    metadata: {
      ...input.metadata,
      direction: 'download',
      status: 'issued',
      source: input.source,
      bytes: input.bytes,
      trafficEventId: input.trafficEventId,
    },
  })
}

export function recordDownloadFailed(
  activity: ActivityWriter,
  input: {
    orgId: string
    userId?: string | null
    actorType?: 'user' | 'anonymous' | 'system' | 'downloader'
    targetType: string
    targetId: string
    targetName: string
    source: string
    bytes: number
    trafficEventId: string
    reason: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  return activity.record({
    orgId: input.orgId,
    userId: input.userId,
    actorType: input.actorType,
    action: 'download_failed',
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    metadata: {
      ...input.metadata,
      direction: 'download',
      status: 'failed',
      source: input.source,
      bytes: input.bytes,
      trafficEventId: input.trafficEventId,
      reason: input.reason,
    },
  })
}
