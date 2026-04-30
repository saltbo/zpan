import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { organization } from './auth-schema'

export const matters = sqliteTable('matters', {
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
  status: text('status').notNull().default('draft'), // draft, active, trashed
  trashedAt: integer('trashed_at'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const storages = sqliteTable('storages', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  mode: text('mode').notNull(),
  bucket: text('bucket').notNull(),
  endpoint: text('endpoint').notNull(),
  region: text('region').notNull().default('auto'),
  accessKey: text('access_key').notNull(),
  secretKey: text('secret_key').notNull(),
  filePath: text('file_path').notNull().default(''),
  customHost: text('custom_host').default(''),
  capacity: integer('capacity').notNull().default(0),
  used: integer('used').notNull().default(0),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const orgQuotas = sqliteTable('org_quotas', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  quota: integer('quota').notNull().default(0),
  used: integer('used').notNull().default(0),
})

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
  public: integer('public', { mode: 'boolean' }).default(false),
})

export const licenseBindings = sqliteTable(
  'license_bindings',
  {
    id: text('id').primaryKey(),
    cloudBindingId: text('cloud_binding_id').notNull(),
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

export const activityEvents = sqliteTable('activity_events', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  action: text('action').notNull(), // 'upload', 'create', 'delete', 'rename', 'move', 'restore'
  targetType: text('target_type').notNull(), // 'file', 'folder'
  targetId: text('target_id'),
  targetName: text('target_name').notNull(),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

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
  (t) => [index('shares_creator_status_created_idx').on(t.creatorId, t.status, t.createdAt)],
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
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('image_hostings_org_path_uniq').on(t.orgId, t.path),
    index('image_hostings_org_created_idx').on(t.orgId, t.createdAt),
    index('image_hostings_token_idx').on(t.token),
  ],
)
