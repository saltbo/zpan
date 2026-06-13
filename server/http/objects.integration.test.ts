import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudTrafficReports } from '../db/schema.js'
import {
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
import { authedHeaders, createTestApp, seedBusinessLicense } from '../test/setup.js'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
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
}

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db'], opts: { metered?: boolean } = {}) {
  const now = Date.now()
  const metered = opts.metered ? 1 : 0
  await db.run(sql`
    INSERT INTO storages (
      id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (
      ${validStorage.id}, ${validStorage.title}, ${validStorage.mode}, ${validStorage.bucket},
      ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey}, ${validStorage.secretKey},
      '', '', 0, 0, 'active', ${metered}, ${100 * 1024 ** 2}, 1, ${now}, ${now}
    )
  `)
}

async function insertFolder(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
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
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string; status?: string; size?: number },
) {
  const now = Date.now()
  const status = opts.status ?? 'active'
  const size = opts.size ?? 100
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', ${size}, 0, ${opts.parent ?? ''}, 'some/key.txt', ${validStorage.id}, ${status}, ${now}, ${now})
  `)
}

async function getOrgQuota(db: Awaited<ReturnType<typeof createTestApp>>['db'], orgId: string) {
  const rows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId} LIMIT 1`)
  return rows[0] ?? null
}

async function getOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`
    SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  return rows[0].id
}

describe('Objects API', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  it('GET /api/objects returns empty list', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('GET /api/objects respects pagination params', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects?page=2&pageSize=10', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
  })

  it('POST /api/objects creates a folder', async () => {
    const { app, db } = await createTestApp()
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
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects returns 500 when no storage available', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain' }),
    })
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Storage not configured' })
  })

  it('GET /api/objects lists active objects in root', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db, { metered: true })
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
    const { app, db } = await createTestApp()
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
    const { app, db } = await createTestApp()
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
    const { app, db } = await createTestApp()
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
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id renames an object', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Old Name' })

    const res = await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', name: 'New Name' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('New Name')
  })

  it('PATCH /api/objects/:id moves an object', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Target Folder' })
    await insertFile(db, orgId, { id: 'm1', name: 'moveme.txt' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', parent: 'Target Folder' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.parent).toBe('Target Folder')
  })

  it('PATCH /api/objects/:id returns 404 for missing object', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', name: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id (action: confirm) confirms upload', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'uploading.txt', status: 'draft' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('PATCH /api/objects/:id (action: confirm) returns 404 for non-draft object', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'already-active.txt', status: 'active' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id (action: cancel) deletes a draft upload and cleans up S3', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'draft-cancel', name: 'cancel.txt', status: 'draft' })

    const res = await app.request('/api/objects/draft-cancel', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; cancelled: boolean }
    expect(body).toEqual({ id: 'draft-cancel', cancelled: true })
    expect(S3Service.prototype.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: validStorage.id }),
      'some/key.txt',
    )

    const check = await app.request('/api/objects/draft-cancel', { headers })
    expect(check.status).toBe(404)
  })

  it('PATCH /api/objects/:id (action: cancel) returns 404 for active object', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'active-cancel', name: 'active.txt', status: 'active' })

    const res = await app.request('/api/objects/active-cancel', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })

    expect(res.status).toBe(404)
  })

  it('DELETE /api/objects/:id rejects active object (must trash first)', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Active Folder' })

    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(409)
  })

  it('DELETE /api/objects/:id permanently deletes a trashed folder', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Delete Me' })

    const trashRes = await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(trashRes.status).toBe(200)

    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.id).toBe('f1')
    expect(body.deleted).toBe(true)

    const check = await app.request('/api/objects/f1', { headers })
    expect(check.status).toBe(404)
  })

  it('DELETE /api/objects/:id permanently deletes a trashed folder with spaces and bracketed tags', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const folderName = 'Project Hail Mary (2026) [IMAX] [1080p] [WEBRip] [5.1] [YTS.BZ]'
    await insertFolder(db, orgId, { id: 'movie-folder', name: folderName })
    await insertFile(db, orgId, { id: 'movie-file', name: 'movie.mkv', parent: folderName })

    const trashRes = await app.request('/api/objects/movie-folder', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(trashRes.status).toBe(200)

    const res = await app.request('/api/objects/movie-folder', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toMatchObject({ id: 'movie-folder', deleted: true, purged: 2 })

    expect(await getMatter(db, 'movie-folder', orgId)).toBeNull()
    expect(await getMatter(db, 'movie-file', orgId)).toBeNull()
  })

  it('PATCH /api/objects/:id (action: trash) trashes a file', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('trashed')
    expect(body.trashedAt).toBeTruthy()

    const list = await app.request('/api/objects?status=trashed', { headers })
    const listBody = (await list.json()) as { total: number }
    expect(listBody.total).toBe(1)
  })

  it('PATCH /api/objects/:id (action: restore) restores a trashed file', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('PATCH /api/objects/:id (action: trash) cascades to folder children', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Parent' })
    await insertFile(db, orgId, { id: 'm1', name: 'child.txt', parent: 'Parent' })
    await insertFolder(db, orgId, { id: 'f2', name: 'Sub', parent: 'Parent' })
    await insertFile(db, orgId, { id: 'm2', name: 'deep.txt', parent: 'f2' })

    const res = await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(res.status).toBe(200)

    const trashed = await app.request('/api/objects?status=trashed', { headers })
    const tBody = (await trashed.json()) as { total: number }
    // Only the root folder shows in root listing of trash
    expect(tBody.total).toBe(1)

    // But all descendants are flagged trashed: restore restores them all
    await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    })
    const childRes = await app.request('/api/objects/m2', { headers })
    const childBody = (await childRes.json()) as Record<string, unknown>
    expect(childBody.status).toBe('active')
  })

  it('GET /api/objects?status=trashed returns trashed folder roots nested under active parents', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'media', name: 'Media' })
    await insertFolder(db, orgId, { id: 'music', name: 'Music', parent: 'Media' })
    await insertFolder(db, orgId, { id: 'album', name: 'Album', parent: 'Media/Music' })
    await insertFile(db, orgId, { id: 'track', name: 'track.flac', parent: 'Media/Music/Album' })

    const trashRes = await app.request('/api/objects/album', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(trashRes.status).toBe(200)

    const res = await app.request('/api/objects?status=trashed', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number }

    expect(body.total).toBe(1)
    expect(body.items.map((item) => item.id)).toEqual(['album'])
  })

  it('DELETE /api/trash purges all trashed items', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })
    await insertFile(db, orgId, { id: 'm2', name: 'b.txt', status: 'trashed' })

    const res = await app.request('/api/trash', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(2)

    const check = await app.request('/api/objects/m1', { headers })
    expect(check.status).toBe(404)
  })

  it('DELETE /api/objects/:id returns 404 for missing object', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/objects/copy copies a folder', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'target', name: 'Dest' })
    await insertFolder(db, orgId, { id: 'f1', name: 'Original' })

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'f1', parent: 'Dest' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('Original')
    expect(body.id).not.toBe('f1')
    expect(body.status).toBe('active')
    expect(body.parent).toBe('Dest')
  })

  it('POST /api/objects/copy returns 404 for missing source', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'nonexistent' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id (action: confirm) returns 404 for missing object', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/objects creates a file with upload URL', async () => {
    const { app, db } = await createTestApp()
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

  it('POST /api/objects/copy copies a file with S3', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'm1', parent: '' }),
    })
    expect(res.status).toBe(201)
    expect(S3Service.prototype.copyObject).toHaveBeenCalled()
  })

  it('DELETE /api/objects/:id permanently deletes a trashed file with S3 cleanup', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt' })

    await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    const res = await app.request('/api/objects/m1', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.deleted).toBe(true)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
  })

  it('DELETE /api/objects/:id purges folder with file children from S3', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Folder' })
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', parent: 'Folder' })
    await insertFile(db, orgId, { id: 'm2', name: 'b.txt', parent: 'Folder' })

    await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(3)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
  })

  it('PATCH /api/objects/:id (action: trash) returns 404 for missing object', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id (action: trash) is idempotent for already-trashed item', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })
    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('trashed')
  })

  it('PATCH /api/objects/:id (action: restore) returns 404 for missing object', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id (action: restore) is no-op for active item', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'active' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
  })

  it('DELETE /api/trash with files calls S3 deleteObjects', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', status: 'trashed' })

    const res = await app.request('/api/trash', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
  })

  it('DELETE /api/trash handles folders (no S3 object) and files together', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Trash Folder' })
    await insertFile(db, orgId, { id: 'm1', name: 'child.txt', parent: 'Trash Folder' })

    // Trash the folder (cascades to child)
    await app.request('/api/objects/f1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'trash' }),
    })

    const res = await app.request('/api/trash', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(2)
  })

  it('DELETE /api/trash returns 0 when trash is empty', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/trash', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { purged: number }
    expect(body.purged).toBe(0)
  })

  it('GET /api/objects/:id returns downloadUrl for files', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })

    const res = await app.request('/api/objects/m1', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadUrl).toBe('https://presigned-download.example.com')
  })

  it('GET /api/objects/:id reports Cloud traffic for bound instances before returning the URL', async () => {
    const { app, db } = await createTestApp({ ZPAN_CLOUD_URL: 'https://cloud.example' })
    const headers = await authedHeaders(app)
    await insertStorage(db, { metered: true })
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })
    await seedBusinessLicense(db)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { eventId: string }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { accepted: true, duplicate: false, eventId: body.eventId } }),
        } as Response
      }),
    )

    const res = await app.request('/api/objects/m1', { headers })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadUrl).toBe('https://presigned-download.example.com')
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(db.select().from(cloudTrafficReports)).resolves.toMatchObject([
      {
        orgId,
        source: 'object_download',
        sourceId: 'm1',
        bytes: 100,
        status: 'reported',
      },
    ])
  })
})

describe('Matter service', () => {
  it('createMatter applies defaults for optional fields', async () => {
    const { db } = await createTestApp()
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
    const { db } = await createTestApp()
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
    const { db } = await createTestApp()
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
    const { db } = await createTestApp()
    const result = await getMatter(db, 'nonexistent', 'org-1')
    expect(result).toBeNull()
  })

  it('updateMatter returns null for missing record', async () => {
    const { db } = await createTestApp()
    const result = await updateMatter(db, 'nonexistent', 'org-1', { name: 'new' })
    expect(result).toBeNull()
  })

  it('confirmUpload returns null for missing record', async () => {
    const { db } = await createTestApp()
    const { matter } = await confirmUpload(db, 'nonexistent', 'org-1')
    expect(matter).toBeNull()
  })

  it('confirmUpload returns null for non-draft status', async () => {
    const { db } = await createTestApp()
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
    const { db } = await createTestApp()
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
    const { db } = await createTestApp()
    const result = await deleteMatter(db, 'nonexistent', 'org-1')
    expect(result).toBeNull()
  })

  it('copyMatter creates a new record from source', async () => {
    const { db } = await createTestApp()
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
    const { db } = await createTestApp()
    const result = await getMatters(db, 'org-1', [])
    expect(result).toEqual([])
  })
})

// ─── Name-conflict route layer ────────────────────────────────────────────────

describe('Objects API — name conflict (409 responses)', () => {
  it('POST /api/objects returns 409 with NAME_CONFLICT code when folder name is already taken', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f-exist', name: 'Duplicates' })

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Duplicates', type: 'folder', dirtype: 1 }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('NAME_CONFLICT')
    expect(body.conflictingName).toBe('Duplicates')
    expect(typeof body.conflictingId).toBe('string')
  })

  it('POST /api/objects with onConflict: rename succeeds and returns auto-renamed folder', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f-exist2', name: 'Reports' })

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Reports', type: 'folder', dirtype: 1, onConflict: 'rename' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('Reports (1)')
  })

  it('PATCH /api/objects/:id rename conflict returns 409 with NAME_CONFLICT code', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'alpha.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'beta.txt' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', name: 'beta.txt' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('NAME_CONFLICT')
    expect(body.conflictingName).toBe('beta.txt')
  })

  it('PATCH /api/objects/:id rename with onConflict: rename succeeds', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'alpha.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'beta.txt' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', name: 'beta.txt', onConflict: 'rename' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('beta (1).txt')
  })

  it('PATCH /api/objects/:id move with collision and no onConflict returns 409', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'file.txt', parent: 'Dest' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', parent: 'Dest' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('NAME_CONFLICT')
  })

  it('PATCH /api/objects/:id move with onConflict: rename resolves collision', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'file.txt', parent: 'Dest' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', parent: 'Dest', onConflict: 'rename' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('file (1).txt')
    expect(body.parent).toBe('Dest')
  })

  it('PATCH /api/objects/:id (action: confirm) returns 409 when active sibling was created during upload', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    // Draft file whose name is now taken by an active sibling
    await insertFile(db, orgId, { id: 'draft1', name: 'upload.txt', status: 'draft' })
    await insertFile(db, orgId, { id: 'active1', name: 'upload.txt', status: 'active' })

    const res = await app.request('/api/objects/draft1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('NAME_CONFLICT')
  })

  it('PATCH /api/objects/:id (action: restore) returns 409 when restore name is already taken', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'trashed1', name: 'note.txt', status: 'trashed' })
    await insertFile(db, orgId, { id: 'active2', name: 'note.txt', status: 'active' })

    const res = await app.request('/api/objects/trashed1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('NAME_CONFLICT')
  })

  it('PATCH /api/objects/:id (action: restore) with onConflict: rename restores with suffix', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'trashed2', name: 'note.txt', status: 'trashed' })
    await insertFile(db, orgId, { id: 'active3', name: 'note.txt', status: 'active' })

    const res = await app.request('/api/objects/trashed2', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', onConflict: 'rename' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('note (1).txt')
    expect(body.status).toBe('active')
  })

  it('POST /api/objects/copy returns 409 when onConflict: fail and target has same name', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'src1', name: 'doc.txt' })
    await insertFile(db, orgId, { id: 'dst1', name: 'doc.txt', parent: 'Dest' })

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'src1', parent: 'Dest', onConflict: 'fail' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.code).toBe('NAME_CONFLICT')
  })

  it('POST /api/objects/copy auto-renames by default when target has same name', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'src2', name: 'photo.jpg' })
    await insertFile(db, orgId, { id: 'dst2', name: 'photo.jpg', parent: 'Dest' })

    const res = await app.request('/api/objects/copy', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ copyFrom: 'src2', parent: 'Dest' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('photo (1).jpg')
  })
})

// ─── Cross-space transfer ─────────────────────────────────────────────────────

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']
type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']

async function getUserIdByEmail(db: TestDb, email: string): Promise<string> {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user WHERE email = ${email}`)
  return rows[0].id
}

async function insertTeamOrg(db: TestDb, id: string): Promise<void> {
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata)
    VALUES (${id}, ${`Team ${id}`}, ${id}, '{"type":"team"}')
  `)
  await db.run(sql`
    INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
    VALUES (${`quota-${id}`}, ${id}, 0, 0, 0, 0, '1970-01')
  `)
}

async function insertMember(db: TestDb, orgId: string, userId: string, role: string): Promise<void> {
  await db.run(sql`
    INSERT INTO member (id, organization_id, user_id, role)
    VALUES (${`member-${orgId}-${userId}`}, ${orgId}, ${userId}, ${role})
  `)
}

async function insertStorageEntitlement(db: TestDb, orgId: string, bytes: number): Promise<void> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO org_quota_entitlements
      (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, status, created_at, updated_at)
    VALUES
      (${`ent-${orgId}`}, ${orgId}, 'storage', 'grant', 'test', ${`test-${orgId}`}, ${bytes}, ${now}, 'active', ${now}, ${now})
  `)
}

function transferRequest(
  app: TestApp,
  headers: Record<string, string>,
  id: string,
  body: { targetOrgId: string; targetParent?: string; mode: 'copy' | 'move' },
) {
  return app.request(`/api/objects/${id}/transfers`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/objects/:id/transfers', () => {
  it('copies a file into a team space the user can edit', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-a')
    await insertMember(db, 'team-a', userId, 'editor')
    await insertFile(db, orgId, { id: 'src-copy', name: 'doc.txt' })

    const res = await transferRequest(app, headers, 'src-copy', { targetOrgId: 'team-a', mode: 'copy' })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { saved: Array<{ orgId: string; name: string }>; sourceDeleted: boolean }
    expect(body.saved).toHaveLength(1)
    expect(body.saved[0].orgId).toBe('team-a')
    expect(body.sourceDeleted).toBe(false)
    expect(S3Service.prototype.copyObject).toHaveBeenCalled()
    const source = await getMatter(db, 'src-copy', orgId)
    expect(source?.status).toBe('active')
  })

  it('moves a file into a team space, deleting the source and releasing its quota', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-b')
    await insertMember(db, 'team-b', userId, 'owner')
    await insertFile(db, orgId, { id: 'src-move', name: 'photo.jpg', size: 1024 })
    await db.run(sql`
      INSERT INTO org_quotas (id, org_id, quota, used, traffic_quota, traffic_used, traffic_period)
      VALUES (${`q-${orgId}`}, ${orgId}, ${1024 * 1024}, 1024, 0, 0, '1970-01')
    `)

    const res = await transferRequest(app, headers, 'src-move', { targetOrgId: 'team-b', mode: 'move' })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { saved: Array<{ orgId: string }>; sourceDeleted: boolean }
    expect(body.sourceDeleted).toBe(true)
    // Source is purged, not trashed — its quota must be released, not double-counted.
    const source = await getMatter(db, 'src-move', orgId)
    expect(source).toBeNull()
    expect((await getOrgQuota(db, orgId))?.used ?? 0).toBe(0)
    const targetList = await listMatters(db, 'team-b', { parent: '', status: 'active', page: 1, pageSize: 10 })
    expect(targetList.items.map((m) => m.name)).toContain('photo.jpg')
  })

  it('copies a folder recursively into the target space', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-c')
    await insertMember(db, 'team-c', userId, 'editor')
    await insertFolder(db, orgId, { id: 'fold-1', name: 'Album' })
    await insertFile(db, orgId, { id: 'in-fold', name: 'pic.png', parent: 'Album' })

    const res = await transferRequest(app, headers, 'fold-1', { targetOrgId: 'team-c', mode: 'copy' })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { saved: Array<{ name: string }> }
    expect(body.saved.map((m) => m.name)).toEqual(expect.arrayContaining(['Album', 'pic.png']))
  })

  it('rejects transfer into a team the user is not a member of', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertTeamOrg(db, 'team-strange')
    await insertFile(db, orgId, { id: 'src-403', name: 'doc.txt' })

    const res = await transferRequest(app, headers, 'src-403', { targetOrgId: 'team-strange', mode: 'copy' })
    expect(res.status).toBe(403)
  })

  it("rejects transfer into another user's personal space", async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await authedHeaders(app, 'victim@example.com')
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const victimId = await getUserIdByEmail(db, 'victim@example.com')
    const victimOrgs = await db.all<{ id: string }>(
      sql`SELECT id FROM organization WHERE slug = ${`personal-${victimId}`}`,
    )
    await insertFile(db, orgId, { id: 'src-victim', name: 'doc.txt' })

    const res = await transferRequest(app, headers, 'src-victim', { targetOrgId: victimOrgs[0].id, mode: 'copy' })
    expect(res.status).toBe(403)
  })

  it('rejects transfer when the target space quota is exceeded', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-small')
    await insertMember(db, 'team-small', userId, 'editor')
    await insertStorageEntitlement(db, 'team-small', 10)
    await insertFile(db, orgId, { id: 'src-big', name: 'big.bin' })

    const res = await transferRequest(app, headers, 'src-big', { targetOrgId: 'team-small', mode: 'copy' })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('QUOTA_EXCEEDED')
  })

  it('rejects transfer to the same space', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'src-same', name: 'doc.txt' })

    const res = await transferRequest(app, headers, 'src-same', { targetOrgId: orgId, mode: 'copy' })
    expect(res.status).toBe(400)
  })
})
