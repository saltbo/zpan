export const ROLLUP_VERSION = 1

export type AdminStatsMetricKind = 'counter' | 'gauge' | 'distinct'

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
} as const

export type AdminStatsDimension = (typeof ADMIN_STATS_DIMENSIONS)[keyof typeof ADMIN_STATS_DIMENSIONS]

export const ADMIN_STATS_METRICS = {
  backgroundJobFinished: 'background_job.finished',
  backgroundJobSnapshot: 'background_job.snapshot',
  downloaderSnapshot: 'downloader.snapshot',
  licenseRefresh: 'license.refresh',
  remoteDownloadTaskCreated: 'remote_download.task_created',
  remoteDownloadTaskFinished: 'remote_download.task_finished',
  remoteDownloadTaskSnapshot: 'remote_download.task_snapshot',
  remoteDownloadUsage: 'remote_download.usage',
  shareCreated: 'share.created',
  shareDownloadIssued: 'share.download_issued',
  shareInventory: 'share.inventory',
  sharePasswordPassed: 'share.password_passed',
  shareSaved: 'share.saved',
  shareView: 'share.view',
  spaceCreated: 'space.created',
  statsMissingBytes: 'stats.quality_missing_bytes',
  statsRollupRun: 'stats.rollup_run',
  storageIngress: 'storage.ingress',
  storageInventory: 'storage.inventory',
  storageQuota: 'storage.quota',
  storageRemoved: 'storage.removed',
  storageRestored: 'storage.restored',
  storageUsed: 'storage.used',
  teamMembershipChange: 'team.membership_change',
  trafficCreditConsumed: 'traffic.credit_consumed',
  trafficQuota: 'traffic.quota',
  trafficQuotaBlocked: 'traffic.quota_blocked',
  trafficQuotaUsed: 'traffic.quota_used',
  trafficReportSync: 'traffic.report_sync',
  transferDownloadFailed: 'transfer.download_failed',
  transferDownloadIssued: 'transfer.download_issued',
  transferUpload: 'transfer.upload',
  userActiveHour: 'user.active_hour',
  userSessionStarted: 'user.session_started',
  userSignup: 'user.signup',
  webhookProcessed: 'webhook.processed',
} as const

export type AdminStatsMetric = (typeof ADMIN_STATS_METRICS)[keyof typeof ADMIN_STATS_METRICS]

export interface AdminStatsMetricDefinition {
  kind: AdminStatsMetricKind
  dimensions: readonly AdminStatsDimension[]
  countUnit: 'events' | 'entities' | 'credits' | null
  bytesUnit: 'bytes' | null
}

const D = ADMIN_STATS_DIMENSIONS
const M = ADMIN_STATS_METRICS

export const ADMIN_STATS_METRIC_REGISTRY = {
  [M.backgroundJobFinished]: counter(['job_type', 'outcome']),
  [M.backgroundJobSnapshot]: gauge(['job_type', 'status'], 'entities'),
  [M.downloaderSnapshot]: gauge(['downloader_id', 'status'], 'entities'),
  [M.licenseRefresh]: counter(['outcome']),
  [M.remoteDownloadTaskCreated]: counter(['category', 'source']),
  [M.remoteDownloadTaskFinished]: counter(['category', 'downloader_id', 'outcome'], true),
  [M.remoteDownloadTaskSnapshot]: gauge(['downloader_id', 'status'], 'entities'),
  [M.remoteDownloadUsage]: {
    kind: 'counter',
    dimensions: [D.downloader, D.status],
    countUnit: 'credits',
    bytesUnit: 'bytes',
  },
  [M.shareCreated]: counter(['kind']),
  [M.shareDownloadIssued]: counter(['actor_type', 'kind', 'share_id', 'source'], true),
  [M.shareInventory]: gauge(['kind', 'lifecycle'], 'entities'),
  [M.sharePasswordPassed]: counter(['share_id']),
  [M.shareSaved]: counter(['actor_type', 'share_id'], true),
  [M.shareView]: counter(['actor_type', 'share_id']),
  [M.spaceCreated]: counter(['org_type']),
  [M.statsMissingBytes]: counter(['direction', 'source']),
  [M.statsRollupRun]: counter(['outcome']),
  [M.storageIngress]: counter(['source', 'status', 'storage_id'], true),
  [M.storageInventory]: gauge(['age_bucket', 'file_type_group', 'size_bucket', 'storage_id'], 'entities', true),
  [M.storageQuota]: gauge([], null, true),
  [M.storageRemoved]: counter(['reason'], true),
  [M.storageRestored]: counter(['source'], true),
  [M.storageUsed]: gauge(['storage_id'], null, true),
  [M.teamMembershipChange]: counter(['outcome']),
  [M.trafficCreditConsumed]: {
    kind: 'counter',
    dimensions: [D.source, D.storage],
    countUnit: 'credits',
    bytesUnit: 'bytes',
  },
  [M.trafficQuota]: gauge([], null, true),
  [M.trafficQuotaBlocked]: counter(['source'], true),
  [M.trafficQuotaUsed]: gauge([], null, true),
  [M.trafficReportSync]: counter(['source', 'status'], true),
  [M.transferDownloadFailed]: counter(['reason', 'source'], true),
  [M.transferDownloadIssued]: counter(['actor_type', 'source', 'storage_id'], true),
  [M.transferUpload]: counter(['reason', 'source', 'status', 'storage_id'], true),
  [M.userActiveHour]: { kind: 'distinct', dimensions: [], countUnit: 'entities', bytesUnit: null },
  [M.userSessionStarted]: counter([]),
  [M.userSignup]: counter(['provider']),
  [M.webhookProcessed]: counter(['outcome']),
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
