import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
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

export const systemOptions = sqliteTable('system_options', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  public: integer('public', { mode: 'boolean' }).default(false),
})

export const teamInviteLinks = sqliteTable('team_invite_links', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  organizationId: text('organization_id').notNull(),
  role: text('role').notNull().default('member'),
  inviterId: text('inviter_id').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})
