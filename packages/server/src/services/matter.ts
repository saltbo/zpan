import type { Storage } from '@zpan/shared/types'
import { sql } from 'drizzle-orm'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { nanoid } from 'nanoid'
import type { Database } from '../platform/interface'
import { buildObjectKey } from './path-template'
import { S3Service } from './s3'

interface CreateFileInput {
  name: string
  size: number
  type: string
  parent: string
}

interface CreateFolderInput {
  name: string
  parent: string
  dirtype: 1
}

type CreateObjectInput = CreateFileInput | CreateFolderInput

function isFolder(input: CreateObjectInput): input is CreateFolderInput {
  return 'dirtype' in input && input.dirtype === 1
}

export interface MatterRow {
  id: string
  orgId: string
  alias: string
  name: string
  type: string
  size: number
  dirtype: number
  parent: string
  object: string
  storageId: string
  status: string
  createdAt: number
  updatedAt: number
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot) : ''
}

function rawName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(0, dot) : name
}

export async function listMatters(
  db: Database,
  orgId: string,
  parent: string,
  status: string,
  page: number,
  pageSize: number,
) {
  const offset = (page - 1) * pageSize

  const countRows = await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM matters WHERE org_id = ${orgId} AND parent = ${parent} AND status = ${status}`,
  )
  const total = countRows[0]?.total ?? 0

  const items = await db.all<MatterRow>(
    sql`SELECT id, org_id AS orgId, alias, name, type, size, dirtype, parent, object, storage_id AS storageId, status, created_at AS createdAt, updated_at AS updatedAt
        FROM matters
        WHERE org_id = ${orgId} AND parent = ${parent} AND status = ${status}
        ORDER BY dirtype DESC, name ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
  )

  return { items, total, page, pageSize }
}

export async function createObject(
  db: Database,
  orgId: string,
  userId: string,
  input: CreateObjectInput,
): Promise<{ matter: MatterRow; uploadUrl?: string }> {
  const now = Math.floor(Date.now() / 1000)
  const id = nanoid()
  const alias = nanoid(10)

  if (isFolder(input)) {
    const matter = buildMatterRow(id, orgId, alias, input.name, 'folder', 0, 1, input.parent, '', '', 'active', now)
    await db.run(
      sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
          VALUES (${id}, ${orgId}, ${alias}, ${input.name}, ${'folder'}, ${0}, ${1}, ${input.parent}, ${''}, ${''}, ${'active'}, ${now}, ${now})`,
    )
    return { matter }
  }

  await checkQuota(db, orgId, input.size)
  const storage = await selectStorage(db, 'private')
  const objectKey = buildObjectKey(storage.filePath || '$UID/$RAW_NAME$RAW_EXT', {
    uid: userId,
    orgId,
    rawName: rawName(input.name),
    rawExt: fileExt(input.name),
    uuid: id,
  })

  await db.run(
    sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES (${id}, ${orgId}, ${alias}, ${input.name}, ${input.type}, ${input.size}, ${0}, ${input.parent}, ${objectKey}, ${storage.id}, ${'draft'}, ${now}, ${now})`,
  )

  const s3 = new S3Service()
  const uploadUrl = await s3.presignUpload(storage as Storage, objectKey, input.type)
  const matter = buildMatterRow(
    id,
    orgId,
    alias,
    input.name,
    input.type,
    input.size,
    0,
    input.parent,
    objectKey,
    storage.id,
    'draft',
    now,
  )
  return { matter, uploadUrl }
}

export async function confirmUpload(db: Database, orgId: string, matterId: string): Promise<MatterRow> {
  const matter = await getMatter(db, orgId, matterId)
  if (matter.status !== 'draft') {
    throw new HttpError(400, 'Only draft objects can be confirmed')
  }
  if (matter.dirtype === 1) {
    throw new HttpError(400, 'Folders do not require upload confirmation')
  }

  const storage = await getStorage(db, matter.storageId)
  const s3 = new S3Service()
  await s3.headObject(storage as Storage, matter.object)

  const now = Math.floor(Date.now() / 1000)
  await db.run(
    sql`UPDATE matters SET status = 'active', updated_at = ${now} WHERE id = ${matterId} AND org_id = ${orgId}`,
  )
  await db.run(sql`UPDATE org_quotas SET used = used + ${matter.size} WHERE org_id = ${orgId}`)

  return { ...matter, status: 'active', updatedAt: now }
}

export async function getDetail(
  db: Database,
  orgId: string,
  matterId: string,
): Promise<{ matter: MatterRow; downloadUrl: string }> {
  const matter = await getMatter(db, orgId, matterId)

  if (matter.dirtype === 1) {
    return { matter, downloadUrl: '' }
  }

  const storage = await getStorage(db, matter.storageId)
  const s3 = new S3Service()
  const downloadUrl =
    (storage as Storage).mode === 'public'
      ? s3.getPublicUrl(storage as Storage, matter.object)
      : await s3.presignDownload(storage as Storage, matter.object, matter.name)

  return { matter, downloadUrl }
}

export async function updateMatter(
  db: Database,
  orgId: string,
  matterId: string,
  updates: { name?: string; parent?: string },
): Promise<MatterRow> {
  const matter = await getMatter(db, orgId, matterId)

  if (updates.parent !== undefined && updates.parent !== '') {
    await getMatterByAlias(db, orgId, updates.parent)
  }

  const name = updates.name ?? matter.name
  const parent = updates.parent ?? matter.parent
  const now = Math.floor(Date.now() / 1000)

  await db.run(
    sql`UPDATE matters SET name = ${name}, parent = ${parent}, updated_at = ${now} WHERE id = ${matterId} AND org_id = ${orgId}`,
  )
  return { ...matter, name, parent, updatedAt: now }
}

export async function copyMatter(
  db: Database,
  orgId: string,
  userId: string,
  matterId: string,
  newParent?: string,
): Promise<MatterRow> {
  const source = await getMatter(db, orgId, matterId)

  if (source.dirtype === 1) {
    throw new HttpError(400, 'Folder copy is not supported')
  }

  await checkQuota(db, orgId, source.size)

  const storage = await getStorage(db, source.storageId)
  const newId = nanoid()
  const newAlias = nanoid(10)
  const now = Math.floor(Date.now() / 1000)

  const newKey = buildObjectKey((storage as Storage).filePath || '$UID/$RAW_NAME$RAW_EXT', {
    uid: userId,
    orgId,
    rawName: rawName(source.name),
    rawExt: fileExt(source.name),
    uuid: newId,
  })

  const s3 = new S3Service()
  await s3.copyObject(storage as Storage, source.object, storage as Storage, newKey)

  const parent = newParent ?? source.parent
  await db.run(
    sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES (${newId}, ${orgId}, ${newAlias}, ${source.name}, ${source.type}, ${source.size}, ${0}, ${parent}, ${newKey}, ${source.storageId}, ${'active'}, ${now}, ${now})`,
  )

  await db.run(sql`UPDATE org_quotas SET used = used + ${source.size} WHERE org_id = ${orgId}`)

  return buildMatterRow(
    newId,
    orgId,
    newAlias,
    source.name,
    source.type,
    source.size,
    0,
    parent,
    newKey,
    source.storageId,
    'active',
    now,
  )
}

export async function permanentDelete(db: Database, orgId: string, matterId: string): Promise<void> {
  const matter = await getMatter(db, orgId, matterId)

  if (matter.status !== 'trashed') {
    throw new HttpError(400, 'Only trashed objects can be permanently deleted')
  }

  if (matter.dirtype === 0 && matter.object) {
    const storage = await getStorage(db, matter.storageId)
    const s3 = new S3Service()
    await s3.deleteObject(storage as Storage, matter.object)
  }

  await db.run(sql`DELETE FROM matters WHERE id = ${matterId} AND org_id = ${orgId}`)
  if (matter.size > 0) {
    await db.run(sql`UPDATE org_quotas SET used = MAX(used - ${matter.size}, 0) WHERE org_id = ${orgId}`)
  }
}

// --- Helpers ---

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
  ) {
    super(message)
  }
}

function buildMatterRow(
  id: string,
  orgId: string,
  alias: string,
  name: string,
  type: string,
  size: number,
  dirtype: number,
  parent: string,
  object: string,
  storageId: string,
  status: string,
  timestamp: number,
): MatterRow {
  return {
    id,
    orgId,
    alias,
    name,
    type,
    size,
    dirtype,
    parent,
    object,
    storageId,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

async function getMatter(db: Database, orgId: string, matterId: string): Promise<MatterRow> {
  const rows = await db.all<MatterRow>(
    sql`SELECT id, org_id AS orgId, alias, name, type, size, dirtype, parent, object, storage_id AS storageId, status, created_at AS createdAt, updated_at AS updatedAt
        FROM matters WHERE id = ${matterId} AND org_id = ${orgId}`,
  )
  if (rows.length === 0) throw new HttpError(404, 'Object not found')
  return rows[0]
}

async function getMatterByAlias(db: Database, orgId: string, alias: string): Promise<MatterRow> {
  const rows = await db.all<MatterRow>(
    sql`SELECT id, org_id AS orgId, alias, name, type, size, dirtype, parent, object, storage_id AS storageId, status, created_at AS createdAt, updated_at AS updatedAt
        FROM matters WHERE alias = ${alias} AND org_id = ${orgId}`,
  )
  if (rows.length === 0) throw new HttpError(404, 'Parent folder not found')
  return rows[0]
}

async function getStorage(db: Database, storageId: string): Promise<StorageRow> {
  const rows = await db.all<StorageRow>(
    sql`SELECT id, uid, title, mode, bucket, endpoint, region, access_key AS accessKey, secret_key AS secretKey, file_path AS filePath, custom_host AS customHost, status
        FROM storages WHERE id = ${storageId}`,
  )
  if (rows.length === 0) throw new HttpError(404, 'Storage not found')
  return rows[0]
}

async function selectStorage(db: Database, mode: string): Promise<StorageRow> {
  const rows = await db.all<StorageRow>(
    sql`SELECT id, uid, title, mode, bucket, endpoint, region, access_key AS accessKey, secret_key AS secretKey, file_path AS filePath, custom_host AS customHost, status
        FROM storages WHERE mode = ${mode} AND status = 1 LIMIT 1`,
  )
  if (rows.length === 0) throw new HttpError(400, 'No storage available')
  return rows[0]
}

async function checkQuota(db: Database, orgId: string, fileSize: number): Promise<void> {
  const rows = await db.all<{ quota: number; used: number }>(
    sql`SELECT quota, used FROM org_quotas WHERE org_id = ${orgId}`,
  )
  if (rows.length === 0) return
  const { quota, used } = rows[0]
  if (quota > 0 && used + fileSize > quota) {
    throw new HttpError(413, 'Storage quota exceeded')
  }
}

interface StorageRow {
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
  status: number
}
