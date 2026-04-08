import { sql } from 'drizzle-orm'
import type { Database } from '../platform/interface'

export interface StorageRow {
  id: string
  uid: string
  title: string
  mode: string
  bucket: string
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  filePath: string
  customHost: string
  capacity: number
  used: number
  status: string
  createdAt: number
  updatedAt: number
}

interface CreateStorageInput {
  uid: string
  title: string
  mode: string
  bucket: string
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  filePath: string
  customHost?: string
  capacity?: number
}

interface UpdateStorageInput {
  title?: string
  mode?: string
  bucket?: string
  endpoint?: string
  region?: string
  accessKey?: string
  secretKey?: string
  filePath?: string
  customHost?: string
  capacity?: number
  status?: string
}

const STORAGE_COLUMNS = sql`
  id, uid, title, mode, bucket, endpoint, region,
  access_key AS accessKey, secret_key AS secretKey,
  file_path AS filePath, custom_host AS customHost,
  capacity, used, status, created_at AS createdAt, updated_at AS updatedAt`

export async function listStorages(db: Database): Promise<StorageRow[]> {
  return db.all<StorageRow>(sql`SELECT ${STORAGE_COLUMNS} FROM storages ORDER BY created_at ASC`)
}

export async function getStorage(db: Database, id: string): Promise<StorageRow | undefined> {
  const rows = await db.all<StorageRow>(sql`SELECT ${STORAGE_COLUMNS} FROM storages WHERE id = ${id}`)
  return rows[0]
}

export async function createStorage(db: Database, input: CreateStorageInput): Promise<StorageRow> {
  const id = crypto.randomUUID()
  const now = Date.now()
  const customHost = input.customHost ?? ''
  const capacity = input.capacity ?? 0

  await db.run(sql`
    INSERT INTO storages (id, uid, title, mode, bucket, endpoint, region,
      access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, ${input.uid}, ${input.title}, ${input.mode}, ${input.bucket},
      ${input.endpoint}, ${input.region}, ${input.accessKey}, ${input.secretKey},
      ${input.filePath}, ${customHost}, ${capacity}, 0, 'active', ${now}, ${now})
  `)

  return {
    id,
    uid: input.uid,
    title: input.title,
    mode: input.mode,
    bucket: input.bucket,
    endpoint: input.endpoint,
    region: input.region,
    accessKey: input.accessKey,
    secretKey: input.secretKey,
    filePath: input.filePath,
    customHost,
    capacity,
    used: 0,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export async function updateStorage(db: Database, id: string, input: UpdateStorageInput): Promise<StorageRow | null> {
  const existing = await db.all<{ id: string }>(sql`SELECT id FROM storages WHERE id = ${id}`)
  if (existing.length === 0) return null

  const now = Date.now()
  await db.run(sql`
    UPDATE storages SET
      title = COALESCE(${input.title ?? null}, title),
      mode = COALESCE(${input.mode ?? null}, mode),
      bucket = COALESCE(${input.bucket ?? null}, bucket),
      endpoint = COALESCE(${input.endpoint ?? null}, endpoint),
      region = COALESCE(${input.region ?? null}, region),
      access_key = COALESCE(${input.accessKey ?? null}, access_key),
      secret_key = COALESCE(${input.secretKey ?? null}, secret_key),
      file_path = COALESCE(${input.filePath ?? null}, file_path),
      custom_host = COALESCE(${input.customHost ?? null}, custom_host),
      capacity = COALESCE(${input.capacity ?? null}, capacity),
      status = COALESCE(${input.status ?? null}, status),
      updated_at = ${now}
    WHERE id = ${id}
  `)

  return (await getStorage(db, id))!
}

export async function deleteStorage(db: Database, id: string): Promise<'ok' | 'not_found' | 'referenced'> {
  const existing = await db.all<{ id: string }>(sql`SELECT id FROM storages WHERE id = ${id}`)
  if (existing.length === 0) return 'not_found'

  const refs = await db.all<{ cnt: number }>(sql`
    SELECT COUNT(*) AS cnt FROM matters WHERE storage_id = ${id}
  `)
  if ((refs[0]?.cnt ?? 0) > 0) return 'referenced'

  await db.run(sql`DELETE FROM storages WHERE id = ${id}`)
  return 'ok'
}

export async function selectStorage(db: Database, mode: 'private' | 'public'): Promise<StorageRow> {
  const rows = await db.all<StorageRow>(sql`
    SELECT ${STORAGE_COLUMNS}
    FROM storages
    WHERE mode = ${mode} AND status = 'active'
      AND (capacity = 0 OR used < capacity)
    ORDER BY created_at ASC
    LIMIT 1
  `)

  if (rows.length === 0) throw new Error('No available storage')
  return rows[0]
}
