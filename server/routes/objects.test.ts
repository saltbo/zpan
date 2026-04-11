import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  batchDelete,
  batchMove,
  batchTrash,
  confirmUpload,
  copyMatter,
  createMatter,
  deleteMatter,
  getMatter,
  getMatters,
  listMatters,
  updateMatter,
} from '../services/matter.js'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

const validStorage = {
  id: 'st-1',
  title: 'Test S3',
  mode: 'private',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  filePath: '$UID/$RAW_NAME',
}

async function insertStorage(db: ReturnType<typeof createTestApp>['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${validStorage.id}, ${validStorage.title}, ${validStorage.mode}, ${validStorage.bucket}, ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey}, ${validStorage.secretKey}, ${validStorage.filePath}, '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function insertFolder(
  db: ReturnType<typeof createTestApp>['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'folder', 0, 1, ${opts.parent ?? ''}, '', ${validStorage.id}, 'active', ${now}, ${now})
  `)
}

async function insertFile(
  db: ReturnType<typeof createTestApp>['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string; status?: string },
) {
  const now = Date.now()
  const status = opts.status ?? 'active'
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', 100, 0, ${opts.parent ?? ''}, 'some/key.txt', ${validStorage.id}, ${status}, ${now}, ${now})
  `)
}

async function getOrgId(db: ReturnType<typeof createTestApp>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

describe('Objects API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  it('GET /api/objects returns empty list', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('GET /api/objects respects pagination params', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects?page=2&pageSize=10', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
  })

  it('POST /api/objects creates a folder', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Folder', type: 'folder', dirtype: 1 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('My Folder')
    expect(body.dirtype).toBe(1)
    expect(body.status).toBe('active')
    expect(body.object).toBe('')
    expect(body.id).toBeTruthy()
  })

  it('POST /api/objects returns 400 for invalid input', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects returns 500 when no storage available', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain' }),
    })
    expect(res.status).toBe(500)
  })

  it('GET /api/objects lists active objects in root', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)

    await insertFolder(db, orgId, { id: 'f1', name: 'Folder A' })
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt' })

    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(2)
    expect(body.items).toHaveLength(2)
    // Folders sort before files (dirtype DESC)
    expect(body.items[0].name).toBe('Folder A')
    expect(body.items[1].name).toBe('file.txt')
  })

  it('GET /api/objects filters by parent', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)

    await insertFolder(db, orgId, { id: 'f1', name: 'Folder A' })
    await insertFile(db, orgId, { id: 'm1', name: 'nested.txt', parent: 'Folder A' })
    await insertFile(db, orgId, { id: 'm2', name: 'root.txt' })

    const res = await app.request(`/api/objects?parent=${encodeURIComponent('Folder A')}`, { headers })
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].name).toBe('nested.txt')
  })

  it('GET /api/objects filters by status', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)

    await insertFile(db, orgId, { id: 'm1', name: 'active.txt', status: 'active' })
    await insertFile(db, orgId, { id: 'm2', name: 'draft.txt', status: 'draft' })

    const res = await app.request('/api/objects?status=draft', { headers })
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].name).toBe('draft.txt')
  })

  it('GET /api/objects/:id returns folder detail', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'My Folder' })

    const res = await app.request('/api/objects/f1', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe('f1')
    expect(body.name).toBe('My Folder')
    // Folder should not have downloadUrl
    expect(body).not.toHaveProperty('downloadUrl')
  })

  it('GET /api/objects/:id returns 404 for missing object', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id renames an object', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Old Name' })

    const res = await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('New Name')
  })

  it('PATCH /api/objects/:id moves an object', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Target Folder' })
    await insertFile(db, orgId, { id: 'm1', name: 'moveme.txt' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: 'Target Folder' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.parent).toBe('Target Folder')
  })

  it('PATCH /api/objects/:id returns 404 for missing object', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id/done confirms upload', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'uploading.txt', status: 'draft' })

    const res = await app.request('/api/objects/m1/done', {
      method: 'PATCH',
      headers,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('PATCH /api/objects/:id/done returns 404 for non-draft object', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'already-active.txt', status: 'active' })

    const res = await app.request('/api/objects/m1/done', {
      method: 'PATCH',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/objects/:id rejects active object (must trash first)', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Active Folder' })

    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(409)
  })

  it('DELETE /api/objects/:id permanently deletes a trashed folder', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Delete Me' })

    const trashRes = await app.request('/api/objects/f1/trash', { method: 'PATCH', headers })
    expect(trashRes.status).toBe(200)

    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe('f1')
    expect(body.deleted).toBe(true)

    const check = await app.request('/api/objects/f1', { headers })
    expect(check.status).toBe(404)
  })

  it('PATCH /api/objects/:id/trash trashes a file', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })

    const res = await app.request('/api/objects/m1/trash', { method: 'PATCH', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('trashed')
    expect(body.trashedAt).toBeTruthy()

    const list = await app.request('/api/objects?status=trashed', { headers })
    const listBody = (await list.json()) as { total: number }
    expect(listBody.total).toBe(1)
  })

  it('PATCH /api/objects/:id/restore restores a trashed file', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })

    const res = await app.request('/api/objects/m1/restore', { method: 'PATCH', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('PATCH /api/objects/:id/trash cascades to folder children', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Parent' })
    await insertFile(db, orgId, { id: 'm1', name: 'child.txt', parent: 'Parent' })
    await insertFolder(db, orgId, { id: 'f2', name: 'Sub', parent: 'Parent' })
    await insertFile(db, orgId, { id: 'm2', name: 'deep.txt', parent: 'f2' })

    const res = await app.request('/api/objects/f1/trash', { method: 'PATCH', headers })
    expect(res.status).toBe(200)

    const trashed = await app.request('/api/objects?status=trashed', { headers })
    const tBody = (await trashed.json()) as { total: number }
    // Only the root folder shows in root listing of trash
    expect(tBody.total).toBe(1)

    // But all descendants are flagged trashed: restore restores them all
    await app.request('/api/objects/f1/restore', { method: 'PATCH', headers })
    const childRes = await app.request('/api/objects/m2', { headers })
    const childBody = (await childRes.json()) as Record<string, unknown>
    expect(childBody.status).toBe('active')
  })

  it('POST /api/recycle-bin/empty purges all trashed items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })
    await insertFile(db, orgId, { id: 'm2', name: 'b.txt', status: 'trashed' })

    const res = await app.request('/api/recycle-bin/empty', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(2)

    const check = await app.request('/api/objects/m1', { headers })
    expect(check.status).toBe(404)
  })

  it('DELETE /api/objects/:id returns 404 for missing object', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/objects/:id/copy copies a folder', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Original' })

    const res = await app.request('/api/objects/f1/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('Original')
    expect(body.id).not.toBe('f1')
    expect(body.status).toBe('active')
  })

  it('POST /api/objects/:id/copy returns 404 for missing source', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id/done returns 404 for missing object', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent/done', {
      method: 'PATCH',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/objects creates a file with upload URL', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'photo.jpg', type: 'image/jpeg', size: 2048 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('draft')
    expect(body.uploadUrl).toBe('https://presigned-upload.example.com')
    expect(body.object).toBeTruthy()
  })

  it('POST /api/objects/:id/copy copies a file with S3', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })

    const res = await app.request('/api/objects/m1/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)
    expect(S3Service.prototype.copyObject).toHaveBeenCalled()
  })

  it('DELETE /api/objects/:id permanently deletes a trashed file with S3 cleanup', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt' })

    await app.request('/api/objects/m1/trash', { method: 'PATCH', headers })
    const res = await app.request('/api/objects/m1', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
  })

  it('DELETE /api/objects/:id purges folder with file children from S3', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Folder' })
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', parent: 'Folder' })
    await insertFile(db, orgId, { id: 'm2', name: 'b.txt', parent: 'Folder' })

    await app.request('/api/objects/f1/trash', { method: 'PATCH', headers })
    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(3)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
  })

  it('PATCH /api/objects/:id/trash returns 404 for missing object', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent/trash', { method: 'PATCH', headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id/trash is idempotent for already-trashed item', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })
    const res = await app.request('/api/objects/m1/trash', { method: 'PATCH', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('trashed')
  })

  it('PATCH /api/objects/:id/restore returns 404 for missing object', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent/restore', { method: 'PATCH', headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id/restore is no-op for active item', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'active' })

    const res = await app.request('/api/objects/m1/restore', { method: 'PATCH', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('POST /api/recycle-bin/empty with files calls S3 deleteObjects', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })

    const res = await app.request('/api/recycle-bin/empty', { method: 'POST', headers })
    expect(res.status).toBe(200)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
  })

  it('POST /api/recycle-bin/empty handles folders (no S3 object) and files together', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Trash Folder' })
    await insertFile(db, orgId, { id: 'm1', name: 'child.txt', parent: 'Trash Folder' })

    // Trash the folder (cascades to child)
    await app.request('/api/objects/f1/trash', { method: 'PATCH', headers })

    const res = await app.request('/api/recycle-bin/empty', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(2)
  })

  it('POST /api/recycle-bin/empty returns 0 when trash is empty', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/recycle-bin/empty', { method: 'POST', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(0)
  })

  it('GET /api/objects/:id returns downloadUrl for files', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })

    const res = await app.request('/api/objects/m1', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadUrl).toBe('https://presigned-download.example.com')
  })

  it('POST /api/objects/batch/move moves multiple items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'b.txt' })

    const res = await app.request('/api/objects/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['m1', 'm2'], parent: 'target' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { moved: number }
    expect(body.moved).toBe(2)
  })

  it('POST /api/objects/batch/move returns 400 for invalid input', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects/batch/move returns 400 if any id missing from org', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })
    const res = await app.request('/api/objects/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['m1', 'nope'], parent: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects/batch/trash trashes items and cascades', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'folder' })
    await insertFile(db, orgId, { id: 'c1', name: 'child.txt', parent: 'folder' })

    const res = await app.request('/api/objects/batch/trash', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { trashed: number }
    expect(body.trashed).toBe(2)
  })

  it('POST /api/objects/batch/trash returns 400 for invalid input', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/batch/trash', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects/batch/delete permanently deletes trashed items', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // Use folders (empty object key) to avoid S3 calls
    const now = Date.now()
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('t1', ${orgId}, 't1-a', 't1', 'folder', 0, 1, '', '', ${validStorage.id}, 'trashed', ${now}, ${now}),
             ('t2', ${orgId}, 't2-a', 't2', 'folder', 0, 1, '', '', ${validStorage.id}, 'trashed', ${now}, ${now})
    `)

    const res = await app.request('/api/objects/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['t1', 't2'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(2)
  })

  it('POST /api/objects/batch/delete returns 400 if any item is not trashed', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'tx', name: 'a.txt', status: 'trashed' })
    await insertFile(db, orgId, { id: 'ax', name: 'b.txt', status: 'active' })

    const res = await app.request('/api/objects/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['tx', 'ax'] }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects/batch/delete returns 400 for invalid input', async () => {
    const { app } = createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects/batch/delete decrements usage for files with size > 0', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const now = Date.now()
    // Insert two trashed files with non-zero sizes and non-empty object keys
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
      VALUES ('td1', ${orgId}, 'td1-a', 'a.txt', 'text/plain', 200, 0, '', 'keys/a.txt', ${validStorage.id}, 'trashed', ${now}, ${now}),
             ('td2', ${orgId}, 'td2-a', 'b.txt', 'text/plain', 300, 0, '', 'keys/b.txt', ${validStorage.id}, 'trashed', ${now}, ${now})
    `)
    // Set storage used to match total file sizes
    await db.run(sql`UPDATE storages SET used = 500 WHERE id = ${validStorage.id}`)

    const res = await app.request('/api/objects/batch/delete', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['td1', 'td2'] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(2)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
    expect(storageRows[0].used).toBe(0)
  })

  it('POST /api/objects/batch/trash returns 400 when IDs do not belong to org', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })

    const res = await app.request('/api/objects/batch/trash', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['m1', 'does-not-exist'] }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
  })

  it('POST /api/objects/batch/move returns 400 when moving folder into itself', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'ParentFolder' })

    const res = await app.request('/api/objects/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'], parent: 'ParentFolder' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(typeof body.error).toBe('string')
  })

  it('POST /api/objects/batch/move cascades path when moving a folder', async () => {
    const { app, db } = createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'FolderA' })
    await insertFolder(db, orgId, { id: 'f2', name: 'Target' })
    await insertFile(db, orgId, { id: 'm1', name: 'child.txt', parent: 'FolderA' })

    const res = await app.request('/api/objects/batch/move', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['f1'], parent: 'Target' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { moved: number }
    expect(body.moved).toBe(1)
  })
})

describe('Matter service', () => {
  it('createMatter applies defaults for optional fields', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)

    const matter = await createMatter(db, {
      orgId: 'org-1',
      name: 'test.txt',
      type: 'text/plain',
      object: 'key.txt',
      storageId: 's1',
      status: 'draft',
    })
    expect(matter.size).toBe(0)
    expect(matter.dirtype).toBe(0)
    expect(matter.parent).toBe('')
    expect(matter.id).toBeTruthy()
    expect(matter.alias).toBeTruthy()
  })

  it('createMatter uses provided optional fields', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)

    const matter = await createMatter(db, {
      orgId: 'org-1',
      name: 'doc.pdf',
      type: 'application/pdf',
      size: 1024,
      dirtype: 1,
      parent: 'folder-1',
      object: '',
      storageId: 's1',
      status: 'active',
    })
    expect(matter.size).toBe(1024)
    expect(matter.dirtype).toBe(1)
    expect(matter.parent).toBe('folder-1')
  })

  it('listMatters returns paginated results', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)

    await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })
    await createMatter(db, {
      orgId: 'org-1',
      name: 'b.txt',
      type: 'text/plain',
      object: 'b',
      storageId: 's1',
      status: 'active',
    })

    const page1 = await listMatters(db, 'org-1', { parent: '', status: 'active', page: 1, pageSize: 1 })
    expect(page1.items).toHaveLength(1)
    expect(page1.total).toBe(2)

    const page2 = await listMatters(db, 'org-1', { parent: '', status: 'active', page: 2, pageSize: 1 })
    expect(page2.items).toHaveLength(1)
  })

  it('getMatter returns null for missing record', async () => {
    const { db } = createTestApp()
    const result = await getMatter(db, 'nonexistent', 'org-1')
    expect(result).toBeNull()
  })

  it('updateMatter returns null for missing record', async () => {
    const { db } = createTestApp()
    const result = await updateMatter(db, 'nonexistent', 'org-1', { name: 'new' })
    expect(result).toBeNull()
  })

  it('confirmUpload returns null for missing record', async () => {
    const { db } = createTestApp()
    const { matter } = await confirmUpload(db, 'nonexistent', 'org-1')
    expect(matter).toBeNull()
  })

  it('confirmUpload returns null for non-draft status', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const matter = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })
    const { matter: result } = await confirmUpload(db, matter.id, 'org-1')
    expect(result).toBeNull()
  })

  it('deleteMatter removes and returns the record', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const matter = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })

    const deleted = await deleteMatter(db, matter.id, 'org-1')
    expect(deleted).not.toBeNull()
    expect(deleted!.id).toBe(matter.id)

    const check = await getMatter(db, matter.id, 'org-1')
    expect(check).toBeNull()
  })

  it('deleteMatter returns null for missing record', async () => {
    const { db } = createTestApp()
    const result = await deleteMatter(db, 'nonexistent', 'org-1')
    expect(result).toBeNull()
  })

  it('copyMatter creates a new record from source', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const source = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      size: 42,
      object: 'original/key',
      storageId: 's1',
      status: 'active',
    })

    const copy = await copyMatter(db, source, 'target-folder', 'copy/key')
    expect(copy.id).not.toBe(source.id)
    expect(copy.alias).not.toBe(source.alias)
    expect(copy.name).toBe('a.txt')
    expect(copy.size).toBe(42)
    expect(copy.parent).toBe('target-folder')
    expect(copy.object).toBe('copy/key')
    expect(copy.status).toBe('active')
  })

  it('getMatters returns empty array for empty ids list', async () => {
    const { db } = createTestApp()
    const result = await getMatters(db, 'org-1', [])
    expect(result).toEqual([])
  })

  it('batchMove moves multiple items to a new parent', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const a = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })
    const b = await createMatter(db, {
      orgId: 'org-1',
      name: 'b.txt',
      type: 'text/plain',
      object: 'b',
      storageId: 's1',
      status: 'active',
    })

    const results = await batchMove(db, 'org-1', [a.id, b.id], 'folder-x')
    expect(results).toHaveLength(2)
    expect(results.every((m) => m.parent === 'folder-x')).toBe(true)

    const check = await getMatters(db, 'org-1', [a.id, b.id])
    expect(check.every((m) => m.parent === 'folder-x')).toBe(true)
  })

  it('batchMove throws if any ID does not belong to the org', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const a = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })

    await expect(batchMove(db, 'org-1', [a.id, 'nonexistent-id'], 'folder-x')).rejects.toThrow(
      'Some IDs do not belong to this organization',
    )
  })

  it('batchTrash sets status to trashed for multiple items', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const a = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })
    const b = await createMatter(db, {
      orgId: 'org-1',
      name: 'b.txt',
      type: 'text/plain',
      object: 'b',
      storageId: 's1',
      status: 'active',
    })

    await batchTrash(db, 'org-1', [a.id, b.id])

    const check = await getMatters(db, 'org-1', [a.id, b.id])
    expect(check.every((m) => m.status === 'trashed')).toBe(true)
  })

  it('batchTrash cascades into folder children', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const folder = await createMatter(db, {
      orgId: 'org-1',
      name: 'folder',
      type: 'folder',
      dirtype: 1,
      object: '',
      storageId: 's1',
      status: 'active',
    })
    const child = await createMatter(db, {
      orgId: 'org-1',
      name: 'child.txt',
      type: 'text/plain',
      object: 'c',
      parent: 'folder',
      storageId: 's1',
      status: 'active',
    })

    await batchTrash(db, 'org-1', [folder.id])

    const checkedFolder = await getMatter(db, folder.id, 'org-1')
    expect(checkedFolder?.status).toBe('trashed')

    const checkedChild = await getMatter(db, child.id, 'org-1')
    expect(checkedChild?.status).toBe('trashed')
  })

  it('batchTrash throws if any ID does not belong to the org', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const a = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'active',
    })

    await expect(batchTrash(db, 'org-1', [a.id, 'nonexistent-id'])).rejects.toThrow(
      'Some IDs do not belong to this organization',
    )
  })

  it('batchDelete permanently deletes trashed items', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const a = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'trashed',
    })
    const b = await createMatter(db, {
      orgId: 'org-1',
      name: 'b.txt',
      type: 'text/plain',
      object: 'b',
      storageId: 's1',
      status: 'trashed',
    })

    const deleted = await batchDelete(db, 'org-1', [a.id, b.id])
    expect(deleted).toHaveLength(2)

    const remaining = await getMatters(db, 'org-1', [a.id, b.id])
    expect(remaining).toHaveLength(0)
  })

  it('batchDelete throws if any item is not trashed', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const trashed = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'trashed',
    })
    const active = await createMatter(db, {
      orgId: 'org-1',
      name: 'b.txt',
      type: 'text/plain',
      object: 'b',
      storageId: 's1',
      status: 'active',
    })

    await expect(batchDelete(db, 'org-1', [trashed.id, active.id])).rejects.toThrow(
      'Only trashed items can be permanently deleted',
    )
  })

  it('batchDelete throws if any ID does not belong to the org', async () => {
    const { db } = createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'S3', 'private', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
    `)
    const trashed = await createMatter(db, {
      orgId: 'org-1',
      name: 'a.txt',
      type: 'text/plain',
      object: 'a',
      storageId: 's1',
      status: 'trashed',
    })

    await expect(batchDelete(db, 'org-1', [trashed.id, 'nonexistent-id'])).rejects.toThrow(
      'Some IDs do not belong to this organization',
    )
  })
})
