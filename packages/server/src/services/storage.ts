import type { CreateStorageInput, UpdateStorageInput } from '@zpan/shared/schemas'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Database } from '../platform/interface'

export interface Storage {
  id: string
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

export async function listStorages(db: Database): Promise<{ items: Storage[]; total: number }> {
  const items = await db.all<Storage>(sql`
    SELECT id, title, mode, bucket, endpoint, region,
           access_key AS accessKey, secret_key AS secretKey,
           file_path AS filePath, custom_host AS customHost,
           capacity, used, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM storages
    ORDER BY created_at ASC
  `)

  return { items, total: items.length }
}

export async function getStorage(db: Database, id: string): Promise<Storage | null> {
  const rows = await db.all<Storage>(sql`
    SELECT id, title, mode, bucket, endpoint, region,
           access_key AS accessKey, secret_key AS secretKey,
           file_path AS filePath, custom_host AS customHost,
           capacity, used, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM storages WHERE id = ${id}
  `)
  return rows[0] ?? null
}

export async function createStorage(db: Database, input: CreateStorageInput): Promise<Storage> {
  const id = nanoid()
  const now = Date.now()
  const capacity = input.capacity ?? 0
  const customHost = input.customHost ?? ''

  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${id}, ${input.title}, ${input.mode}, ${input.bucket}, ${input.endpoint}, ${input.region}, ${input.accessKey}, ${input.secretKey}, ${input.filePath}, ${customHost}, ${capacity}, 0, 'active', ${now}, ${now})
  `)

  return {
    id,
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

export async function updateStorage(db: Database, id: string, input: UpdateStorageInput): Promise<Storage | null> {
  const existing = await getStorage(db, id)
  if (!existing) return null

  const now = Date.now()
  const updated = {
    title: input.title ?? existing.title,
    mode: input.mode ?? existing.mode,
    bucket: input.bucket ?? existing.bucket,
    endpoint: input.endpoint ?? existing.endpoint,
    region: input.region ?? existing.region,
    accessKey: input.accessKey ?? existing.accessKey,
    secretKey: input.secretKey ?? existing.secretKey,
    filePath: input.filePath ?? existing.filePath,
    customHost: input.customHost ?? existing.customHost,
    capacity: input.capacity ?? existing.capacity,
    status: input.status ?? existing.status,
  }

  await db.run(sql`
    UPDATE storages SET
      title = ${updated.title}, mode = ${updated.mode}, bucket = ${updated.bucket},
      endpoint = ${updated.endpoint}, region = ${updated.region},
      access_key = ${updated.accessKey}, secret_key = ${updated.secretKey},
      file_path = ${updated.filePath}, custom_host = ${updated.customHost},
      capacity = ${updated.capacity}, status = ${updated.status},
      updated_at = ${now}
    WHERE id = ${id}
  `)

  return { ...existing, ...updated, updatedAt: now }
}

export async function deleteStorage(db: Database, id: string): Promise<'ok' | 'not_found' | 'in_use'> {
  const existing = await getStorage(db, id)
  if (!existing) return 'not_found'

  const refs = await db.all<{ count: number }>(sql`SELECT COUNT(*) AS count FROM matters WHERE storage_id = ${id}`)
  if ((refs[0]?.count ?? 0) > 0) return 'in_use'

  await db.run(sql`DELETE FROM storages WHERE id = ${id}`)
  return 'ok'
}

export async function selectStorage(db: Database, mode: 'private' | 'public'): Promise<Storage> {
  const rows = await db.all<Storage>(sql`
    SELECT id, title, mode, bucket, endpoint, region,
           access_key AS accessKey, secret_key AS secretKey,
           file_path AS filePath, custom_host AS customHost,
           capacity, used, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM storages
    WHERE mode = ${mode} AND status = 'active'
      AND (capacity = 0 OR used < capacity)
    ORDER BY created_at ASC
    LIMIT 1
  `)

  if (rows.length === 0) throw new Error('No available storage')
  return rows[0]
}
