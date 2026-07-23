import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { organization } from './auth-schema'

export const matters = sqliteTable(
  'matters',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    alias: text('alias').notNull().unique(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    size: integer('size').default(0),
    dirtype: integer('dirtype').default(0),
    parent: text('parent').notNull().default(''),
    object: text('object').notNull().default(''),
    storageId: text('storage_id').notNull(),
    status: text('status').notNull().default('draft'), // draft, active
    trashedAt: integer('trashed_at'), // null = live, epoch ms = in trash (soft delete)
    purgedAt: integer('purged_at'), // null = retained/billable, epoch ms = content permanently removed
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('matters_status_dir_created_idx').on(t.status, t.dirtype, t.createdAt)],
)

export const webdavDeadProperties = sqliteTable(
  'webdav_dead_properties',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    resourcePath: text('resource_path').notNull(),
    namespace: text('namespace').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('webdav_dead_properties_resource_prop_uniq').on(t.orgId, t.resourcePath, t.namespace, t.name),
    index('webdav_dead_properties_resource_idx').on(t.orgId, t.resourcePath),
  ],
)

export const webdavLocks = sqliteTable(
  'webdav_locks',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    orgId: text('org_id').notNull(),
    resourcePath: text('resource_path').notNull(),
    owner: text('owner').notNull().default(''),
    depth: text('depth').notNull().default('infinity'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('webdav_locks_resource_idx').on(t.orgId, t.resourcePath),
    index('webdav_locks_expires_idx').on(t.expiresAt),
  ],
)

export const storages = sqliteTable('storages', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default(''),
  bucket: text('bucket').notNull(),
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull().default('auto'),
  accessKey: text('access_key').notNull(),
  secretKey: text('secret_key').notNull(),
  filePath: text('file_path').notNull().default(''),
  customHost: text('custom_host').default(''),
  capacity: integer('capacity').notNull().default(0),
  egressCreditBillingEnabled: integer('egress_credit_billing_enabled', { mode: 'boolean' }).notNull().default(false),
  egressCreditUnitBytes: integer('egress_credit_unit_bytes').notNull().default(104857600),
  egressCreditPerUnit: integer('egress_credit_per_unit').notNull().default(1),
  forcePathStyle: integer('force_path_style', { mode: 'boolean' }).notNull().default(true),
  used: integer('used').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  status: text('status').notNull().default('unknown'),
  statusReason: text('status_reason'),
  statusCheckedAt: integer('status_checked_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const orgQuotas = sqliteTable(
  'org_quotas',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    quota: integer('quota').notNull().default(0),
    used: integer('used').notNull().default(0),
    trafficQuota: integer('traffic_quota').notNull().default(0),
    trafficUsed: integer('traffic_used').notNull().default(0),
    trafficPeriod: text('traffic_period').notNull().default('1970-01'),
  },
  (t) => [uniqueIndex('org_quotas_org_uniq').on(t.orgId)],
)

export const storageUsageBreakdowns = sqliteTable(
  'storage_usage_breakdowns',
  {
    orgId: text('org_id').notNull(),
    category: text('category').notNull(),
    bytes: integer('bytes').notNull().default(0),
    fileCount: integer('file_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('storage_usage_breakdowns_org_category_uniq').on(t.orgId, t.category),
    index('storage_usage_breakdowns_org_idx').on(t.orgId),
  ],
)

export const cloudTrafficReports = sqliteTable(
  'cloud_traffic_reports',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    period: text('period').notNull(),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    eventId: text('event_id').notNull(),
    bytes: integer('bytes').notNull(),
    storageId: text('storage_id'),
    unitBytes: integer('unit_bytes'),
    creditsPerUnit: integer('credits_per_unit'),
    status: text('status').notNull(),
    error: text('error'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('cloud_traffic_reports_event_uniq').on(t.eventId),
    index('cloud_traffic_reports_org_period_idx').on(t.orgId, t.period),
    index('cloud_traffic_reports_status_idx').on(t.status),
    index('cloud_traffic_reports_retry_idx').on(t.status, t.nextRetryAt, t.createdAt),
    index('cloud_traffic_reports_issued_idx').on(t.issuedAt),
    index('cloud_traffic_reports_updated_idx').on(t.updatedAt),
  ],
)

export const orgQuotaEntitlements = sqliteTable(
  'org_quota_entitlements',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    resourceType: text('resource_type').notNull(),
    entitlementType: text('entitlement_type').notNull().default('grant'),
    source: text('source').notNull(),
    sourceId: text('source_id').notNull(),
    bytes: integer('bytes').notNull(),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    status: text('status').notNull(),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('org_quota_entitlements_org_resource_idx').on(t.orgId, t.resourceType, t.status),
    index('org_quota_entitlements_org_type_idx').on(t.orgId, t.resourceType, t.entitlementType, t.status),
    uniqueIndex('org_quota_entitlements_active_plan_uniq')
      .on(t.orgId, t.resourceType, t.entitlementType)
      .where(sql`status = 'active' AND entitlement_type = 'plan' AND source <> 'free_plan'`),
    uniqueIndex('org_quota_entitlements_source_resource_uniq').on(t.source, t.sourceId, t.resourceType),
  ],
)

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull().default('cloud'),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull().default('order.quota_changed'),
    payloadHash: text('payload_hash').notNull(),
    rawPayload: text('raw_payload').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('webhook_events_source_event_uniq').on(t.source, t.eventId),
    index('webhook_events_source_created_idx').on(t.source, t.createdAt),
    index('webhook_events_status_idx').on(t.status),
    index('webhook_events_processed_idx').on(t.processedAt),
  ],
)

export const inviteCodes = sqliteTable('invite_codes', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  createdBy: text('created_by').notNull(),
  usedBy: text('used_by'),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

export const siteInvitations = sqliteTable(
  'site_invitations',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    token: text('token').notNull().unique(),
    invitedBy: text('invited_by').notNull(),
    acceptedBy: text('accepted_by'),
    acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
    revokedBy: text('revoked_by'),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    index('site_invitations_email_idx').on(t.email),
    index('site_invitations_created_idx').on(t.createdAt),
    index('site_invitations_expires_idx').on(t.expiresAt),
  ],
)

export const systemOptions = sqliteTable('system_options', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
})

export const licenseBindings = sqliteTable(
  'license_bindings',
  {
    id: text('id').primaryKey(),
    cloudBindingId: text('cloud_binding_id').notNull(),
    cloudStoreId: text('cloud_store_id'),
    instanceId: text('instance_id').notNull(),
    cloudAccountId: text('cloud_account_id').notNull(),
    cloudAccountEmail: text('cloud_account_email'),
    status: text('status').notNull(),
    refreshToken: text('refresh_token'),
    cachedCertificate: text('cached_certificate'),
    cachedCertificateExpiresAt: integer('cached_certificate_expires_at'),
    boundAt: integer('bound_at').notNull(),
    disconnectedAt: integer('disconnected_at'),
    lastRefreshAt: integer('last_refresh_at'),
    lastRefreshError: text('last_refresh_error'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('license_bindings_active_uniq').on(t.status).where(sql`status = 'active'`),
    index('license_bindings_cloud_binding_idx').on(t.cloudBindingId),
    index('license_bindings_instance_idx').on(t.instanceId),
  ],
)

export const teamInviteLinks = sqliteTable('team_invite_links', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  organizationId: text('organization_id').notNull(),
  role: text('role').notNull().default('member'),
  inviterId: text('inviter_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(), // e.g. 'share_received'
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    refType: text('ref_type'), // e.g. 'share'
    refId: text('ref_id'),
    metadata: text('metadata'), // JSON string for extra context
    readAt: integer('read_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_read_idx').on(t.userId, t.readAt),
  ],
)

export const backgroundJobs = sqliteTable(
  'background_jobs',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    targetFolder: text('target_folder'),
    targetPath: text('target_path'),
    metadata: text('metadata'),
    inputBytes: integer('input_bytes').notNull().default(0),
    outputBytes: integer('output_bytes').notNull().default(0),
    processedBytes: integer('processed_bytes').notNull().default(0),
    fileCount: integer('file_count').notNull().default(0),
    currentFilename: text('current_filename'),
    errorMessage: text('error_message'),
    resultMetadata: text('result_metadata'),
    retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
    cancelable: integer('cancelable', { mode: 'boolean' }).notNull().default(true),
    retriedFromJobId: text('retried_from_job_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('background_jobs_org_created_idx').on(t.orgId, t.createdAt),
    index('background_jobs_org_status_idx').on(t.orgId, t.status),
    index('background_jobs_org_type_idx').on(t.orgId, t.type),
    index('background_jobs_created_idx').on(t.createdAt),
  ],
)

export const downloaders = sqliteTable(
  'downloaders',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenJti: text('token_jti').notNull().unique(),
    status: text('status').notNull().default('offline'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    version: text('version').notNull().default('unknown'),
    hostname: text('hostname').notNull().default('unknown'),
    platform: text('platform').notNull().default('unknown'),
    arch: text('arch').notNull().default('unknown'),
    engine: text('engine').notNull().default('http'),
    capabilities: text('capabilities').notNull().default('[]'),
    maxConcurrentTasks: integer('max_concurrent_tasks').notNull().default(1),
    currentTasks: integer('current_tasks').notNull().default(0),
    downloadBps: integer('download_bps').notNull().default(0),
    uploadBps: integer('upload_bps').notNull().default(0),
    freeDiskBytes: integer('free_disk_bytes').notNull().default(0),
    remoteDownloadCreditBillingEnabled: integer('remote_download_credit_billing_enabled', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    remoteDownloadCreditUnitBytes: integer('remote_download_credit_unit_bytes').notNull().default(104857600),
    remoteDownloadCreditPerUnit: integer('remote_download_credit_per_unit').notNull().default(1),
    lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp_ms' }),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('downloaders_status_idx').on(t.status),
    index('downloaders_enabled_idx').on(t.enabled),
    index('downloaders_created_idx').on(t.createdAt),
  ],
)

export const downloadTasks = sqliteTable(
  'download_tasks',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    createdByUserId: text('created_by_user_id').notNull(),
    sourceType: text('source_type').notNull(),
    sourceUri: text('source_uri').notNull(),
    displayName: text('display_name'),
    targetFolder: text('target_folder').notNull().default(''),
    category: text('category'),
    tags: text('tags').notNull().default('[]'),
    assignedDownloaderId: text('assigned_downloader_id'),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    billingAuthorizedBytes: integer('billing_authorized_bytes').notNull().default(0),
    billingChargedBytes: integer('billing_charged_bytes').notNull().default(0),
    billingChargedCredits: integer('billing_charged_credits').notNull().default(0),
    billingStatus: text('billing_status').notNull().default('none'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    resultObjectId: text('result_object_id'),
    runtime: text('runtime'),
    events: text('events').notNull().default('[]'),
    resolveStartedAt: integer('resolve_started_at', { mode: 'timestamp_ms' }),
    resolveCompletedAt: integer('resolve_completed_at', { mode: 'timestamp_ms' }),
    downloadCompletedAt: integer('download_completed_at', { mode: 'timestamp_ms' }),
    ingestStartedAt: integer('ingest_started_at', { mode: 'timestamp_ms' }),
    ingestCompletedAt: integer('ingest_completed_at', { mode: 'timestamp_ms' }),
    seedingStartedAt: integer('seeding_started_at', { mode: 'timestamp_ms' }),
    seedingStoppedAt: integer('seeding_stopped_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    assignedAt: integer('assigned_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('download_tasks_org_created_idx').on(t.orgId, t.createdAt),
    index('download_tasks_org_status_idx').on(t.orgId, t.status),
    index('download_tasks_org_category_idx').on(t.orgId, t.category),
    index('download_tasks_org_tags_idx').on(t.orgId, t.tags),
    index('download_tasks_downloader_idx').on(t.assignedDownloaderId, t.status),
    index('download_tasks_created_idx').on(t.createdAt),
    index('download_tasks_finished_idx').on(t.finishedAt),
    index('download_tasks_org_deleted_created_idx').on(t.orgId, t.deletedAt, t.createdAt),
  ],
)

export const objectUploadSessions = sqliteTable(
  'object_upload_sessions',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    objectId: text('object_id').notNull(),
    storageId: text('storage_id').notNull(),
    storageKey: text('storage_key').notNull(),
    uploadId: text('upload_id'), // null for a single-PutObject (≤5 GiB) session; set for multipart
    partSize: integer('part_size').notNull(),
    onConflict: text('on_conflict').notNull().default('fail'), // strategy captured at create, applied at completion
    status: text('status').notNull(),
    createdBy: text('created_by').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('object_upload_sessions_object_idx').on(t.orgId, t.objectId),
    index('object_upload_sessions_expires_idx').on(t.expiresAt),
  ],
)

export const remoteDownloadUsageReports = sqliteTable(
  'remote_download_usage_reports',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    downloaderId: text('downloader_id').notNull(),
    taskId: text('task_id').notNull(),
    eventId: text('event_id').notNull().unique(),
    unitIndex: integer('unit_index').notNull(),
    unitBytes: integer('unit_bytes').notNull(),
    creditsPerUnit: integer('credits_per_unit').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('remote_download_usage_task_unit_uniq').on(t.taskId, t.unitIndex),
    index('remote_download_usage_org_idx').on(t.orgId),
    index('remote_download_usage_status_idx').on(t.status),
    index('remote_download_usage_created_idx').on(t.createdAt),
  ],
)

export const announcements = sqliteTable(
  'announcements',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    status: text('status').notNull().default('draft'),
    priority: integer('priority').notNull().default(0),
    publishedAt: integer('published_at', { mode: 'timestamp' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    index('announcements_status_priority_idx').on(t.status, t.priority),
    index('announcements_published_idx').on(t.publishedAt),
  ],
)

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    userId: text('user_id'),
    action: text('action').notNull(), // 'upload', 'create', 'delete', 'rename', 'move', 'restore'
    targetType: text('target_type').notNull(), // 'file', 'folder'
    targetId: text('target_id'),
    targetName: text('target_name').notNull(),
    metadata: text('metadata'), // JSON
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    actorType: text('actor_type'),
    actorRef: text('actor_ref'),
  },
  (t) => [
    index('audit_events_org_created_idx').on(t.orgId, t.createdAt),
    index('audit_events_user_created_idx').on(t.userId, t.createdAt),
    index('audit_events_action_created_idx').on(t.action, t.createdAt),
    index('audit_events_target_created_idx').on(t.targetType, t.targetId, t.createdAt),
    index('audit_events_created_idx').on(t.createdAt),
  ],
)

export const statsRollupsHourly = sqliteTable(
  'stats_rollups_hourly',
  {
    id: text('id').primaryKey(),
    bucketStart: integer('bucket_start', { mode: 'timestamp_ms' }).notNull(),
    orgId: text('org_id').notNull().default(''),
    metricKey: text('metric_key').notNull(),
    dimensionKey: text('dimension_key').notNull().default(''),
    dimensionValue: text('dimension_value').notNull().default(''),
    count: integer('count').notNull().default(0),
    bytes: integer('bytes').notNull().default(0),
    uniqueCount: integer('unique_count').notNull().default(0),
    metadata: text('metadata'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('stats_rollups_hourly_bucket_metric_dim_uniq').on(
      t.bucketStart,
      t.orgId,
      t.metricKey,
      t.dimensionKey,
      t.dimensionValue,
    ),
    index('stats_rollups_hourly_metric_bucket_idx').on(t.metricKey, t.bucketStart),
    index('stats_rollups_hourly_dimension_bucket_idx').on(t.metricKey, t.dimensionKey, t.bucketStart),
  ],
)

export const storageUsageLedger = sqliteTable(
  'storage_usage_ledger',
  {
    id: text('id').primaryKey(),
    eventKey: text('event_key').notNull().unique(),
    orgId: text('org_id').notNull(),
    storageId: text('storage_id').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    deltaBytes: integer('delta_bytes').notNull(),
    reason: text('reason').notNull(),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('storage_usage_ledger_occurred_idx').on(t.occurredAt),
    index('storage_usage_ledger_org_occurred_idx').on(t.orgId, t.occurredAt),
    index('storage_usage_ledger_storage_occurred_idx').on(t.storageId, t.occurredAt),
  ],
)

export const shares = sqliteTable(
  'shares',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    kind: text('kind').notNull(), // 'landing' | 'direct'
    matterId: text('matter_id').notNull(),
    orgId: text('org_id').notNull(),
    creatorId: text('creator_id').notNull(),
    passwordHash: text('password_hash'),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    downloadLimit: integer('download_limit'),
    views: integer('views').notNull().default(0),
    downloads: integer('downloads').notNull().default(0),
    status: text('status').notNull().default('active'), // 'active' | 'revoked'
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    index('shares_creator_status_created_idx').on(t.creatorId, t.status, t.createdAt),
    index('shares_created_idx').on(t.createdAt),
  ],
)

export const shareRecipients = sqliteTable(
  'share_recipients',
  {
    id: text('id').primaryKey(),
    shareId: text('share_id').notNull(),
    recipientUserId: text('recipient_user_id'),
    recipientEmail: text('recipient_email'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [
    index('share_recipients_share_id_idx').on(t.shareId),
    index('share_recipients_user_id_idx').on(t.recipientUserId),
  ],
)

// image_hosting_configs — per-org singleton; row exists => feature enabled
export const imageHostingConfigs = sqliteTable('image_hosting_configs', {
  orgId: text('org_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),
  customDomain: text('custom_domain').unique(),
  cfHostnameId: text('cf_hostname_id'),
  domainVerifiedAt: integer('domain_verified_at', { mode: 'timestamp_ms' }),
  refererAllowlist: text('referer_allowlist'), // JSON array of strings; null/empty => allow all
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// image_hostings — one row per hosted image
export const imageHostings = sqliteTable(
  'image_hostings',
  {
    id: text('id').primaryKey(), // nanoid(12)
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(), // "ih_" + nanoid(10)
    path: text('path').notNull(), // virtual path e.g. "blog/2026/04/shot.png"
    storageId: text('storage_id')
      .notNull()
      .references(() => storages.id),
    storageKey: text('storage_key').notNull(), // "ih/<orgId>/<id>.<ext>"
    size: integer('size').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    status: text('status').notNull().default('draft'), // 'draft' | 'active'
    purgedAt: integer('purged_at'),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('image_hostings_org_path_uniq').on(t.orgId, t.path).where(sql`${t.purgedAt} IS NULL`),
    index('image_hostings_org_created_idx').on(t.orgId, t.createdAt),
    index('image_hostings_token_idx').on(t.token),
  ],
)
