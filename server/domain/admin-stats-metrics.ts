export const ROLLUP_VERSION = 3

export type AdminStatsRollupScope = 'counters' | 'snapshots' | 'full'

export interface AdminStatsRollupMetadata {
  version: number
  scope: AdminStatsRollupScope
  quality: 'exact' | 'lower_bound'
  counterQuality?: 'exact' | 'lower_bound'
  snapshotQuality?: 'exact' | 'lower_bound'
  snapshotObservedAt?: string
}

export type AdminStatsMetricKind = 'counter' | 'gauge'

export const ADMIN_STATS_DIMENSIONS = {
  actorType: 'actor_type',
  ageBucket: 'age_bucket',
  category: 'category',
  downloader: 'downloader_id',
  direction: 'direction',
  fileType: 'file_type_group',
  jobType: 'job_type',
  kind: 'kind',
  lifecycle: 'lifecycle',
  orgType: 'org_type',
  outcome: 'outcome',
  provider: 'provider',
  reason: 'reason',
  routeFamily: 'route_family',
  share: 'share_id',
  sizeBucket: 'size_bucket',
  source: 'source',
  status: 'status',
  storage: 'storage_id',
  window: 'window',
} as const

export type AdminStatsDimension = (typeof ADMIN_STATS_DIMENSIONS)[keyof typeof ADMIN_STATS_DIMENSIONS]

export const ADMIN_STATS_METRICS = {
  backgroundJobFinished: 'background_job.finished',
  backgroundJobSnapshot: 'background_job.snapshot',
  downloaderSnapshot: 'downloader.snapshot',
  remoteDownloadTaskFinished: 'remote_download.task_finished',
  remoteDownloadTaskSnapshot: 'remote_download.task_snapshot',
  shareCreated: 'share.created',
  shareDownloadIssued: 'share.download_issued',
  shareInventory: 'share.inventory',
  sharePasswordPassed: 'share.password_passed',
  shareSaved: 'share.saved',
  shareView: 'share.view',
  statsDataQualitySnapshot: 'stats.data_quality_snapshot',
  statsMissingBytes: 'stats.quality_missing_bytes',
  statsRollupRun: 'stats.rollup_run',
  storageInventory: 'storage.inventory',
  storageQuota: 'storage.quota',
  storageTrashSnapshot: 'storage.trash_snapshot',
  storageUsed: 'storage.used',
  trafficReportSnapshot: 'traffic.report_snapshot',
  transferDownloadFailed: 'transfer.download_failed',
  transferDownloadIssued: 'transfer.download_issued',
  transferUpload: 'transfer.upload',
  userSignup: 'user.signup',
  userActiveSnapshot: 'user.active_snapshot',
  userInventory: 'user.inventory',
  webhookSnapshot: 'webhook.snapshot',
} as const

export type AdminStatsMetric = (typeof ADMIN_STATS_METRICS)[keyof typeof ADMIN_STATS_METRICS]

export interface AdminStatsMetricDefinition {
  kind: AdminStatsMetricKind
  dimensions: readonly AdminStatsDimension[]
  countUnit: 'events' | 'entities' | 'credits' | null
  bytesUnit: 'bytes' | null
}

const M = ADMIN_STATS_METRICS

export const ADMIN_STATS_METRIC_REGISTRY = {
  [M.backgroundJobFinished]: counter(['job_type', 'outcome']),
  [M.backgroundJobSnapshot]: gauge(['job_type', 'status'], 'entities'),
  [M.downloaderSnapshot]: gauge(['downloader_id', 'status'], 'entities'),
  [M.remoteDownloadTaskFinished]: counter(['category', 'downloader_id', 'outcome'], true),
  [M.remoteDownloadTaskSnapshot]: gauge(['downloader_id', 'status'], 'entities'),
  [M.shareCreated]: counter(['kind']),
  [M.shareDownloadIssued]: counter(['actor_type', 'kind', 'share_id', 'source'], true),
  [M.shareInventory]: gauge(['kind', 'lifecycle'], 'entities'),
  [M.sharePasswordPassed]: counter(['share_id']),
  [M.shareSaved]: counter(['actor_type', 'share_id'], true),
  [M.shareView]: counter(['actor_type', 'share_id']),
  [M.statsDataQualitySnapshot]: gauge(['kind'], 'events', true),
  [M.statsMissingBytes]: counter(['direction', 'source']),
  [M.statsRollupRun]: counter(['outcome']),
  [M.storageInventory]: gauge(['age_bucket', 'file_type_group', 'size_bucket', 'storage_id'], 'entities', true),
  [M.storageQuota]: gauge(['status'], null, true),
  [M.storageTrashSnapshot]: gauge(['storage_id'], 'entities', true),
  [M.storageUsed]: gauge(['storage_id'], null, true),
  [M.trafficReportSnapshot]: gauge(['status'], 'entities', true),
  [M.transferDownloadFailed]: counter(['reason', 'source'], true),
  [M.transferDownloadIssued]: counter(['actor_type', 'source', 'storage_id'], true),
  [M.transferUpload]: counter(['reason', 'source', 'status', 'storage_id'], true),
  [M.userSignup]: counter(['provider']),
  [M.userActiveSnapshot]: gauge(['window'], 'entities'),
  [M.userInventory]: gauge(['status'], 'entities'),
  [M.webhookSnapshot]: gauge(['status'], 'entities'),
} satisfies Record<AdminStatsMetric, AdminStatsMetricDefinition>

function counter(dimensions: readonly AdminStatsDimension[], bytes = false): AdminStatsMetricDefinition {
  return { kind: 'counter', dimensions, countUnit: 'events', bytesUnit: bytes ? 'bytes' : null }
}

function gauge(
  dimensions: readonly AdminStatsDimension[],
  countUnit: AdminStatsMetricDefinition['countUnit'],
  bytes = false,
): AdminStatsMetricDefinition {
  return { kind: 'gauge', dimensions, countUnit, bytesUnit: bytes ? 'bytes' : null }
}

export function metricDefinition(metric: AdminStatsMetric): AdminStatsMetricDefinition {
  return ADMIN_STATS_METRIC_REGISTRY[metric]
}

export function assertMetricDimension(
  metric: AdminStatsMetric,
  dimension: string,
): asserts dimension is AdminStatsDimension | '' {
  if (dimension === '' || metricDefinition(metric).dimensions.includes(dimension as AdminStatsDimension)) return
  throw new Error(`Unsupported stats dimension: ${metric}/${dimension}`)
}

export function parseAdminStatsRollupMetadata(metadata: string | null): AdminStatsRollupMetadata | null {
  if (!metadata) return null
  try {
    const value: unknown = JSON.parse(metadata)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (record.version !== ROLLUP_VERSION) return null
    if (record.scope !== 'counters' && record.scope !== 'snapshots' && record.scope !== 'full') return null
    if (record.quality !== 'exact' && record.quality !== 'lower_bound') return null
    if (
      record.counterQuality !== undefined &&
      record.counterQuality !== 'exact' &&
      record.counterQuality !== 'lower_bound'
    ) {
      return null
    }
    if (
      record.snapshotQuality !== undefined &&
      record.snapshotQuality !== 'exact' &&
      record.snapshotQuality !== 'lower_bound'
    ) {
      return null
    }
    const snapshotObservedAt = record.snapshotObservedAt ?? record.observedAt
    if (
      snapshotObservedAt !== undefined &&
      (typeof snapshotObservedAt !== 'string' || !Number.isFinite(Date.parse(snapshotObservedAt)))
    ) {
      return null
    }
    return {
      version: record.version,
      scope: record.scope,
      quality: record.quality,
      counterQuality: record.counterQuality,
      snapshotQuality: record.snapshotQuality,
      snapshotObservedAt,
    }
  } catch {
    return null
  }
}
