import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const matters = sqliteTable('matters', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull(),
  alias: text('alias').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  size: integer('size').default(0),
  dirtype: integer('dirtype').default(0),
  parent: text('parent').notNull().default(''),
  object: text('object').notNull().default(''),
  storageId: text('storage_id').notNull(),
  status: text('status').notNull().default('draft'), // draft, active, trashed
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
  filePath: text('file_path').notNull().default('$UID/$RAW_NAME'),
  customHost: text('custom_host').default(''),
  capacityBytes: integer('capacity_bytes'),
  usedBytes: integer('used_bytes').default(0),
  priority: integer('priority').default(0),
  status: integer('status').default(1),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const storageQuotas = sqliteTable('storage_quotas', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  quota: integer('quota').notNull(),
  used: integer('used').default(0),
})

export const systemOptions = sqliteTable('system_options', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default(''),
  public: integer('public', { mode: 'boolean' }).default(false),
})
