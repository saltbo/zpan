import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../adapters/gateways/s3.js'
import { createMatterRepo } from '../adapters/repos/matter.js'
import { createQuotaRepo } from '../adapters/repos/quota.js'
import { createStorageUsageRepo } from '../adapters/repos/storage-usage.js'
import { cloudTrafficReports, orgQuotaEntitlements, orgQuotas } from '../db/schema.js'
import { currentTrafficPeriod } from '../domain/quota.js'
import { adminHeaders, authedHeaders, createTestApp, seedBusinessLicense, seedProLicense } from '../test/setup.js'
import { type ConfirmUploadOptions, confirmUpload as confirmUploadUsecase } from '../usecases/object.js'
import type {
  CopyMatterOptions,
  CreateMatterInput,
  Matter,
  MatterListFilters,
  UpdateMatterInput,
} from '../usecases/ports.js'

type TestDbForMatter = Awaited<ReturnType<typeof createTestApp>>['db']

// Thin adapters preserving the former matter service signatures so these
// behavioral tests exercise the migrated MatterRepo + confirmUpload usecase
// unchanged.
function createMatter(db: TestDbForMatter, input: CreateMatterInput): Promise<Matter> {
  return createMatterRepo(db).create(input)
}
function getMatter(db: TestDbForMatter, id: string, orgId: string) {
  return createMatterRepo(db).get(id, orgId)
}
function getMatters(db: TestDbForMatter, orgId: string, ids: string[]) {
  return createMatterRepo(db).getMany(orgId, ids)
}
function listMatters(db: TestDbForMatter, orgId: string, filters: MatterListFilters) {
  return createMatterRepo(db).list(orgId, filters)
}
function updateMatter(db: TestDbForMatter, id: string, orgId: string, input: UpdateMatterInput) {
  return createMatterRepo(db).update(id, orgId, input)
}
function copyMatter(
  db: TestDbForMatter,
  source: Matter,
  targetParent: string,
  newObject: string,
  opts?: CopyMatterOptions,
) {
  return createMatterRepo(db).copy(source, targetParent, newObject, opts)
}
async function deleteMatter(db: TestDbForMatter, id: string, orgId: string) {
  const repo = createMatterRepo(db)
  const existing = await repo.get(id, orgId)
  if (!existing) return null
  await repo.purge(orgId, [id])
  return existing
}
function confirmUpload(db: TestDbForMatter, id: string, orgId: string, opts: ConfirmUploadOptions = {}) {
  return confirmUploadUsecase(
    {
      matter: createMatterRepo(db),
      quota: createQuotaRepo(db),
      storageUsage: createStorageUsageRepo(db),
    },
    id,
    orgId,
    opts,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'deleteObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'deleteObjects').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'presignUpload').mockResolvedValue('https://presigned-upload.example.com')
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://presigned-download.example.com')
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
  // Single-PUT completion HEADs the object and matches the client's reported ETag.
  // Tests that finalize a ≤5 GiB upload send parts:[{partNumber:1, etag:'abc'}].
  vi.spyOn(S3Service.prototype, 'headObject').mockResolvedValue({
    size: 100,
    contentType: 'text/plain',
    etag: 'abc',
  })
  vi.spyOn(S3Service.prototype, 'completeMultipartUpload').mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const validStorage = {
  id: 'st-1',
  bucket: 'test-bucket',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

async function insertStorage(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  opts: { id?: string; metered?: boolean; capacity?: number; used?: number; status?: string } = {},
) {
  const now = Date.now()
  const metered = opts.metered ? 1 : 0
  const id = opts.id ?? validStorage.id
  await db.run(sql`
    INSERT INTO storages (
      id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (
      ${id}, ${validStorage.bucket},
      ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey}, ${validStorage.secretKey},
      '', '', ${opts.capacity ?? 0}, ${opts.used ?? 0}, ${opts.status ?? 'active'}, ${metered}, ${100 * 1024 ** 2}, 1, ${now}, ${now}
    )
  `)
}

async function insertFolder(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string; trashedAt?: number },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'folder', 0, 1, ${opts.parent ?? ''}, '', ${validStorage.id}, 'active', ${opts.trashedAt ?? null}, ${now}, ${now})
  `)
}

// Inserts a matter row. A "trashed" object is status='active' with trashedAt set;
// a "draft" is status='draft'. Pass `trashedAt` to drop the row in the recycle bin.
async function insertFile(
  db: Awaited<ReturnType<typeof createTestApp>>['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string; status?: string; size?: number; trashedAt?: number },
) {
  const now = Date.now()
  const status = opts.status ?? 'active'
  const size = opts.size ?? 100
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', ${size}, 0, ${opts.parent ?? ''}, 'some/key.txt', ${validStorage.id}, ${status}, ${opts.trashedAt ?? null}, ${now}, ${now})
  `)
}

// Drives the full file-upload flow against the in-memory app: POST /api/objects
// creates a draft + upload session, then POST .../completions finalizes it to a
// live object. Returns the created object id. The S3 spies make the single-PUT
// HEAD return etag 'abc', so completions sends a matching part.
async function _uploadFile(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  headers: Record<string, string>,
  body: { name: string; type?: string; size?: number; parent?: string; onConflict?: string },
): Promise<string> {
  const createRes = await app.request('/api/objects', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'text/plain', size: 100, parent: '', dirtype: 0, ...body }),
  })
  if (createRes.status !== 201) throw new Error(`create failed: ${createRes.status}`)
  const created = (await createRes.json()) as { id: string; upload: { sessionId: string } }
  const completeRes = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
  })
  if (completeRes.status !== 200) throw new Error(`complete failed: ${completeRes.status}`)
  return created.id
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
  it('returns 401 without auth [spec: objects/auth-required]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  it('GET /api/objects returns empty list [spec: objects/list-empty]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
  })

  it('GET /api/objects respects pagination params [spec: objects/list-pagination]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects?page=2&pageSize=10', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: number; pageSize: number }
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
  })

  // Regression: the file manager loads a whole folder client-side with
  // FILES_PAGE_SIZE=500, so the objects list must accept a pageSize above the
  // shared 100 cap. A stricter cap silently 400s the list and the UI never renders.
  it('GET /api/objects accepts the file-manager pageSize of 500', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects?pageSize=500', { headers })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { pageSize: number }).pageSize).toBe(500)
  })

  it('POST /api/objects creates a folder [spec: objects/create-folder]', async () => {
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

  it('POST /api/objects returns 400 for invalid input [spec: objects/create-invalid]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/objects returns 503 when no storage available [spec: objects/create-no-storage]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'test.txt', type: 'text/plain' }),
    })
    expect(res.status).toBe(503)
    const body = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
    expect(body.error.message).toBe('No storage configured')
    expect(body.error.details[0].reason).toBe('NO_STORAGE_CONFIGURED')
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

  it('GET /api/objects filters by parent [spec: objects/list-by-parent]', async () => {
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

  it('GET /api/objects lists live objects only — excludes drafts and trashed [spec: objects/list-live-only]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)

    await insertFile(db, orgId, { id: 'm1', name: 'active.txt', status: 'active' })
    await insertFile(db, orgId, { id: 'm2', name: 'draft.txt', status: 'draft' })
    await insertFile(db, orgId, { id: 'm3', name: 'trashed.txt', trashedAt: Date.now() })

    const res = await app.request('/api/objects', { headers })
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; total: number }
    expect(body.total).toBe(1)
    expect(body.items[0].name).toBe('active.txt')
  })

  it('GET /api/objects/:id returns folder detail [spec: objects/detail]', async () => {
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

  it('GET /api/objects/:id returns 404 for missing object [spec: objects/detail-missing]', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', { headers })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/objects/:id renames an object [spec: objects/rename]', async () => {
    const { app, db } = await createTestApp()
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

  it('PATCH /api/objects/:id moves an object [spec: objects/move]', async () => {
    const { app, db } = await createTestApp()
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
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/objects/:id/uploads/:sid/completions finalizes a draft to a live object [spec: objects/complete-upload]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)

    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'uploading.txt', type: 'text/plain', size: 100, parent: '', dirtype: 0 }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string; status: string; upload: { sessionId: string } }
    expect(created.status).toBe('draft')

    const res = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
    expect(body.trashedAt).toBeNull()

    // The live object now appears in the listing.
    const list = await app.request('/api/objects', { headers })
    expect(((await list.json()) as { total: number }).total).toBe(1)
    void db
  })

  it('POST .../completions rejects a single-PUT whose ETag does not match the HEAD [spec: objects/complete-etag-mismatch]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    void db

    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'mismatch.txt', type: 'text/plain', size: 100, parent: '', dirtype: 0 }),
    })
    const created = (await createRes.json()) as { id: string; upload: { sessionId: string } }

    const res = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'wrong' }] }),
    })
    // ETag mismatch surfaces as an invalid upload-session state → 409.
    expect(res.status).toBe(409)
    const events = await db.all<{ metadata: string }>(sql`
      SELECT metadata FROM audit_events
      WHERE action = 'upload_failed' AND target_id = ${created.id}
    `)
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      bytes: 100,
      source: 'upload',
      status: 'failed',
      reason: 'etag_mismatch',
    })
  })

  it('DELETE /api/objects/:id/uploads/:sid aborts the upload and discards the draft [spec: objects/abort-upload]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)

    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cancel.txt', type: 'text/plain', size: 100, parent: '', dirtype: 0 }),
    })
    const created = (await createRes.json()) as { id: string; upload: { sessionId: string } }

    const res = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}`, {
      method: 'DELETE',
      headers,
    })
    expect(res.status).toBe(204)
    // Single-PUT abort best-effort deletes the S3 object and removes the draft row.
    expect(S3Service.prototype.deleteObject).toHaveBeenCalled()
    const check = await app.request(`/api/objects/${created.id}`, { headers })
    expect(check.status).toBe(404)
    void db
  })

  it('DELETE /api/objects/:id soft-deletes a live object → 204 and moves it to trash [spec: objects/trash]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })

    const res = await app.request('/api/objects/m1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    // Gone from the live listing…
    const list = await app.request('/api/objects', { headers })
    expect(((await list.json()) as { total: number }).total).toBe(0)
    // …and present in the recycle bin with trashedAt set.
    const trash = await app.request('/api/trash/objects', { headers })
    const trashBody = (await trash.json()) as { items: Array<{ id: string; trashedAt: number }>; total: number }
    expect(trashBody.total).toBe(1)
    expect(trashBody.items[0].id).toBe('m1')
    expect(trashBody.items[0].trashedAt).toBeTruthy()
  })

  it('DELETE /api/objects/:id soft-deletes a folder, cascading its subtree to trash [spec: objects/trash-cascade]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Parent' })
    await insertFile(db, orgId, { id: 'm1', name: 'child.txt', parent: 'Parent' })
    await insertFolder(db, orgId, { id: 'f2', name: 'Sub', parent: 'Parent' })
    await insertFile(db, orgId, { id: 'm2', name: 'deep.txt', parent: 'f2' })

    const res = await app.request('/api/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    // Only the root folder shows in the trash root listing…
    const trash = await app.request('/api/trash/objects', { headers })
    expect(((await trash.json()) as { total: number }).total).toBe(1)

    // …but every descendant is flagged trashed: restore brings them all back.
    const restoreRes = await app.request('/api/trash/objects/f1/restorations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(restoreRes.status).toBe(200)
    const childRes = await app.request('/api/objects/m2', { headers })
    expect(((await childRes.json()) as { status: string }).status).toBe('active')
  })

  it('POST /api/trash/objects/:id/restorations restores a trashed object [spec: objects/restore]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', trashedAt: Date.now() })

    const res = await app.request('/api/trash/objects/m1/restorations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
    expect(body.trashedAt).toBeNull()
  })

  it('GET /api/trash/objects/:id returns a trashed object; 404 for a live one [spec: objects/get-trashed]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'gone', name: 'gone.txt', trashedAt: Date.now() })
    await insertFile(db, orgId, { id: 'live', name: 'live.txt' })

    const trashedRes = await app.request('/api/trash/objects/gone', { headers })
    expect(trashedRes.status).toBe(200)
    expect(((await trashedRes.json()) as { id: string }).id).toBe('gone')

    const liveRes = await app.request('/api/trash/objects/live', { headers })
    expect(liveRes.status).toBe(404)
  })

  it('GET /api/trash/objects lists trashed folder roots only [spec: objects/list-trashed]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'media', name: 'Media' })
    await insertFolder(db, orgId, { id: 'music', name: 'Music', parent: 'Media' })
    await insertFolder(db, orgId, { id: 'album', name: 'Album', parent: 'Media/Music' })
    await insertFile(db, orgId, { id: 'track', name: 'track.flac', parent: 'Media/Music/Album' })

    const trashRes = await app.request('/api/objects/album', { method: 'DELETE', headers })
    expect(trashRes.status).toBe(204)

    const res = await app.request('/api/trash/objects', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ id: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.items.map((item) => item.id)).toEqual(['album'])
  })

  it('DELETE /api/trash/objects/:id permanently purges a trashed folder [spec: objects/purge-folder]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'f1', name: 'Delete Me', trashedAt: Date.now() })

    const res = await app.request('/api/trash/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    expect(await getMatter(db, 'f1', orgId)).toBeNull()
  })

  it('DELETE /api/trash/objects/:id purges a trashed folder with spaces and bracketed tags', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const folderName = 'Project Hail Mary (2026) [IMAX] [1080p] [WEBRip] [5.1] [YTS.BZ]'
    const trashedAt = Date.now()
    await insertFolder(db, orgId, { id: 'movie-folder', name: folderName, trashedAt })
    await insertFile(db, orgId, { id: 'movie-file', name: 'movie.mkv', parent: folderName, trashedAt })

    const res = await app.request('/api/trash/objects/movie-folder', { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    expect(await getMatter(db, 'movie-folder', orgId)).toBeNull()
    expect(await getMatter(db, 'movie-file', orgId)).toBeNull()
    const tombstones = await db.all<{ id: string; purgedAt: number | null }>(sql`
      SELECT id, purged_at AS purgedAt FROM matters
      WHERE id IN ('movie-folder', 'movie-file')
      ORDER BY id
    `)
    expect(tombstones).toHaveLength(2)
    expect(tombstones.every((row) => typeof row.purgedAt === 'number')).toBe(true)
    const ledger = await db.all<{ bytes: number }>(sql`
      SELECT COALESCE(SUM(delta_bytes), 0) AS bytes
      FROM storage_usage_ledger
      WHERE org_id = ${orgId} AND storage_id = ${validStorage.id}
    `)
    expect(ledger[0].bytes).toBe(0)
  })

  it('DELETE /api/objects/:id is idempotent for an already-trashed object → 204', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', trashedAt: Date.now() })

    const res = await app.request('/api/objects/m1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
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

  it('POST /api/objects/copy copies a folder [spec: objects/copy-folder]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFolder(db, orgId, { id: 'target', name: 'Dest' })
    await insertFolder(db, orgId, { id: 'f1', name: 'Original' })

    const res = await app.request('/api/objects/f1/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: 'Dest' }),
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
    const res = await app.request('/api/objects/nonexistent/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })

  it('POST .../completions returns 404 for a missing upload session', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent/uploads/no-session/completions', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/objects creates a file draft with single-PUT upload instructions [spec: objects/create-file-presign]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'photo.jpg', type: 'image/jpeg', size: 2048 }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      status: string
      object: string
      upload: { sessionId: string; partSize: number; urls: string[] }
    }
    expect(body.status).toBe('draft')
    expect(body.object).toBeTruthy()
    // ≤5 GiB → single PutObject: one URL, partSize equals the file size.
    expect(body.upload.sessionId).toBeTruthy()
    expect(body.upload.partSize).toBe(2048)
    expect(body.upload.urls).toEqual(['https://presigned-upload.example.com'])
  })

  it('POST /api/objects with storageId uses that exact eligible storage', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await insertStorage(db, { id: 'st-oldest' })
    await insertStorage(db, { id: 'st-target' })

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'target.txt', type: 'text/plain', size: 1, storageId: 'st-target' }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; storageId: string }
    expect(body.storageId).toBe('st-target')
    const rows = await db.all<{ storageId: string }>(
      sql`SELECT storage_id as storageId FROM matters WHERE id = ${body.id}`,
    )
    expect(rows[0].storageId).toBe('st-target')
  })

  it('POST /api/objects with ineligible storageId fails before draft/session creation', async () => {
    for (const storage of [
      { id: 'missing' },
      { id: 'inactive', status: 'disabled' },
      { id: 'full', capacity: 1, used: 1 },
    ]) {
      const { app, db } = await createTestApp()
      const headers = await adminHeaders(app)
      if (storage.id !== 'missing') await insertStorage(db, storage)

      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${storage.id}.txt`, type: 'text/plain', size: 1, storageId: storage.id }),
      })

      expect(res.status).toBe(503)
      const matters = await db.all<{ count: number }>(sql`SELECT COUNT(*) as count FROM matters`)
      const sessions = await db.all<{ count: number }>(sql`SELECT COUNT(*) as count FROM object_upload_sessions`)
      expect(matters[0].count).toBe(0)
      expect(sessions[0].count).toBe(0)
    }
  })

  it('POST /api/objects with storageId is admin-only and fails before draft/session creation', async () => {
    const { app, db } = await createTestApp()
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'editor@example.com')
    await insertStorage(db, { id: 'st-target' })

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'target.txt', type: 'text/plain', size: 1, storageId: 'st-target' }),
    })

    expect(res.status).toBe(403)
    const matters = await db.all<{ count: number }>(sql`SELECT COUNT(*) as count FROM matters`)
    const sessions = await db.all<{ count: number }>(sql`SELECT COUNT(*) as count FROM object_upload_sessions`)
    expect(matters[0].count).toBe(0)
    expect(sessions[0].count).toBe(0)
  })

  it('POST /api/objects rejects a file larger than 5 TiB [spec: objects/create-file-too-large]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'huge.bin', type: 'application/octet-stream', size: 5 * 1024 ** 4 + 1 }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('FILE_TOO_LARGE')
  })

  it('POST /api/objects/copy copies a file with S3 [spec: objects/copy-file]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })

    const res = await app.request('/api/objects/m1/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(201)
    expect(S3Service.prototype.copyObject).toHaveBeenCalled()
  })

  it('DELETE /api/trash/objects/:id permanently deletes a trashed file with S3 cleanup [spec: objects/purge-file-s3]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt', trashedAt: Date.now() })

    const res = await app.request('/api/trash/objects/m1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
    expect(await getMatter(db, 'm1', orgId)).toBeNull()
  })

  it('DELETE /api/trash/objects/:id purges a folder with file children from S3', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const trashedAt = Date.now()
    await insertFolder(db, orgId, { id: 'f1', name: 'Folder', trashedAt })
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt', parent: 'Folder', trashedAt })
    await insertFile(db, orgId, { id: 'm2', name: 'b.txt', parent: 'Folder', trashedAt })

    const res = await app.request('/api/trash/objects/f1', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    expect(S3Service.prototype.deleteObjects).toHaveBeenCalled()
    expect(await getMatter(db, 'f1', orgId)).toBeNull()
    expect(await getMatter(db, 'm1', orgId)).toBeNull()
    expect(await getMatter(db, 'm2', orgId)).toBeNull()
  })

  it('DELETE /api/objects/:id returns 404 for a missing object (soft-delete)', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/objects/nonexistent', { method: 'DELETE', headers })
    expect(res.status).toBe(404)
  })

  it('DELETE /api/trash/objects/:id returns 404 for a live (non-trashed) object', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })

    const res = await app.request('/api/trash/objects/m1', { method: 'DELETE', headers })
    expect(res.status).toBe(404)
  })

  it('POST /api/trash/objects/:id/restorations returns 404 for a missing object', async () => {
    const { app } = await createTestApp()
    const headers = await authedHeaders(app)
    const res = await app.request('/api/trash/objects/nonexistent/restorations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(404)
  })

  it('POST /api/trash/objects/:id/restorations on a live object is a no-op (stays active)', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'a.txt' })

    const res = await app.request('/api/trash/objects/m1/restorations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.status).toBe('active')
    expect(body.trashedAt).toBeNull()
  })

  it('GET /api/objects/:id returns downloadUrl for files [spec: objects/download-url]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'doc.txt' })

    const res = await app.request('/api/objects/m1', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.downloadUrl).toBe('https://presigned-download.example.com')
    const events = await db.all<{
      userId: string
      actorType: string
      bytes: number
      source: string
      trafficEventId: string
    }>(sql`
      SELECT
        user_id AS userId,
        actor_type AS actorType,
        json_extract(metadata, '$.bytes') AS bytes,
        json_extract(metadata, '$.source') AS source,
        json_extract(metadata, '$.trafficEventId') AS trafficEventId
      FROM audit_events
      WHERE action = 'object_download' AND target_id = 'm1'
    `)
    expect(events).toEqual([
      {
        userId: expect.any(String),
        actorType: 'user',
        bytes: 100,
        source: 'object_download',
        trafficEventId: expect.any(String),
      },
    ])
  })

  it('GET /api/objects/:id reports Cloud traffic for bound instances before returning the URL [spec: objects/download-traffic]', async () => {
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
    await expect(
      db.select().from(cloudTrafficReports).where(eq(cloudTrafficReports.orgId, orgId)),
    ).resolves.toMatchObject([{ orgId, source: 'object_download', sourceId: 'm1', bytes: 100, status: 'reported' }])
  })
})

describe('Matter service', () => {
  it('createMatter applies defaults for optional fields', async () => {
    const { db } = await createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
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
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
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
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
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

    const page1 = await listMatters(db, 'org-1', { parent: '', page: 1, pageSize: 1 })
    expect(page1.items).toHaveLength(1)
    expect(page1.total).toBe(2)

    const page2 = await listMatters(db, 'org-1', { parent: '', page: 2, pageSize: 1 })
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
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
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

  it('deleteMatter hides and retains the purged record', async () => {
    const { db } = await createTestApp()
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
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
    const retained = await db.all<{ purgedAt: number | null }>(
      sql`SELECT purged_at AS purgedAt FROM matters WHERE id = ${matter.id}`,
    )
    expect(retained[0]?.purgedAt).toEqual(expect.any(Number))
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
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES ('s1', 'b', 'https://s3.example.com', 'us-east-1', 'k', 's', '$UID/$RAW_NAME', '', 0, 0, 'active', ${now}, ${now})
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
  it('POST /api/objects returns 409 with NAME_CONFLICT code when folder name is already taken [spec: objects/create-conflict]', async () => {
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
    const body = (await res.json()) as {
      error: { details: Array<{ reason: string; metadata: Record<string, string> }> }
    }
    expect(body.error.details[0].reason).toBe('NAME_CONFLICT')
    expect(body.error.details[0].metadata.conflictingName).toBe('Duplicates')
    expect(typeof body.error.details[0].metadata.conflictingId).toBe('string')
  })

  it('POST /api/objects with onConflict: rename succeeds and returns auto-renamed folder [spec: objects/create-conflict-rename]', async () => {
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

  it('PATCH /api/objects/:id rename conflict returns 409 with NAME_CONFLICT code [spec: objects/rename-conflict]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'alpha.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'beta.txt' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'beta.txt' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as {
      error: { details: Array<{ reason: string; metadata: Record<string, string> }> }
    }
    expect(body.error.details[0].reason).toBe('NAME_CONFLICT')
    expect(body.error.details[0].metadata.conflictingName).toBe('beta.txt')
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
      body: JSON.stringify({ name: 'beta.txt', onConflict: 'rename' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('beta (1).txt')
  })

  it('PATCH /api/objects/:id move with collision and no onConflict returns 409 [spec: objects/move-conflict]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm1', name: 'file.txt' })
    await insertFile(db, orgId, { id: 'm2', name: 'file.txt', parent: 'Dest' })

    const res = await app.request('/api/objects/m1', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: 'Dest' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('NAME_CONFLICT')
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
      body: JSON.stringify({ parent: 'Dest', onConflict: 'rename' }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.name).toBe('file (1).txt')
    expect(body.parent).toBe('Dest')
  })

  it('POST .../completions returns 409 when an active sibling appeared during upload', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)

    // Start a real upload (creates the draft + session)…
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'upload.txt', type: 'text/plain', size: 100, parent: '', dirtype: 0 }),
    })
    const created = (await createRes.json()) as { id: string; upload: { sessionId: string } }
    // …then a same-named active sibling lands before completion.
    await insertFile(db, orgId, { id: 'active1', name: 'upload.txt', status: 'active' })

    const res = await app.request(`/api/objects/${created.id}/uploads/${created.upload.sessionId}/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('NAME_CONFLICT')
  })

  it('POST /api/trash/objects/:id/restorations returns 409 when restore name is already taken [spec: objects/restore-conflict]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'trashed1', name: 'note.txt', trashedAt: Date.now() })
    await insertFile(db, orgId, { id: 'active2', name: 'note.txt', status: 'active' })

    const res = await app.request('/api/trash/objects/trashed1/restorations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('NAME_CONFLICT')
  })

  it('POST /api/trash/objects/:id/restorations with onConflict: rename restores with suffix', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'trashed2', name: 'note.txt', trashedAt: Date.now() })
    await insertFile(db, orgId, { id: 'active3', name: 'note.txt', status: 'active' })

    const res = await app.request('/api/trash/objects/trashed2/restorations', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ onConflict: 'rename' }),
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

    const res = await app.request('/api/objects/src1/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: 'Dest', onConflict: 'fail' }),
    })

    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('NAME_CONFLICT')
  })

  it('POST /api/objects/copy auto-renames by default when target has same name', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'src2', name: 'photo.jpg' })
    await insertFile(db, orgId, { id: 'dst2', name: 'photo.jpg', parent: 'Dest' })

    const res = await app.request('/api/objects/src2/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: 'Dest' }),
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
  it('copies a file into a team space the user can edit [spec: objects/transfer-copy]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-a')
    await insertMember(db, 'team-a', userId, 'editor')
    await insertStorageEntitlement(db, 'team-a', 10_000_000)
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

  it('moves a file into a team space, deleting the source and releasing its quota [spec: objects/transfer-move]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-b')
    await insertMember(db, 'team-b', userId, 'owner')
    await insertStorageEntitlement(db, 'team-b', 10_000_000)
    await insertFile(db, orgId, { id: 'src-move', name: 'photo.jpg', size: 1024 })
    await db.run(sql`
      UPDATE org_quotas
      SET quota = ${1024 * 1024}, used = 1024, traffic_quota = 0, traffic_used = 0, traffic_period = '1970-01'
      WHERE org_id = ${orgId}
    `)

    const res = await transferRequest(app, headers, 'src-move', { targetOrgId: 'team-b', mode: 'move' })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { saved: Array<{ orgId: string }>; sourceDeleted: boolean }
    expect(body.sourceDeleted).toBe(true)
    // Source is purged, not trashed — its quota must be released, not double-counted.
    const source = await getMatter(db, 'src-move', orgId)
    expect(source).toBeNull()
    expect((await getOrgQuota(db, orgId))?.used ?? 0).toBe(0)
    const targetList = await listMatters(db, 'team-b', { parent: '', page: 1, pageSize: 10 })
    expect(targetList.items.map((m) => m.name)).toContain('photo.jpg')
  })

  it('copies a folder recursively into the target space [spec: objects/transfer-folder]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-c')
    await insertMember(db, 'team-c', userId, 'editor')
    await insertStorageEntitlement(db, 'team-c', 10_000_000)
    await insertFolder(db, orgId, { id: 'fold-1', name: 'Album' })
    await insertFile(db, orgId, { id: 'in-fold', name: 'pic.png', parent: 'Album' })

    const res = await transferRequest(app, headers, 'fold-1', { targetOrgId: 'team-c', mode: 'copy' })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { saved: Array<{ name: string }> }
    expect(body.saved.map((m) => m.name)).toEqual(expect.arrayContaining(['Album', 'pic.png']))
  })

  it('rejects transfer into a team the user is not a member of [spec: objects/transfer-permission]', async () => {
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
    const victimOrgs = await db.all<{ id: string }>(sql`
      SELECT o.id
      FROM organization o
      INNER JOIN member m ON m.organization_id = o.id
      WHERE m.user_id = ${victimId}
        AND (o.slug LIKE 'personal-%' OR COALESCE(o.metadata, '') LIKE '%"type":"personal"%')
      LIMIT 1
    `)
    await insertFile(db, orgId, { id: 'src-victim', name: 'doc.txt' })

    const res = await transferRequest(app, headers, 'src-victim', { targetOrgId: victimOrgs[0].id, mode: 'copy' })
    expect(res.status).toBe(403)
  })

  it('rejects transfer when the target space quota is exceeded [spec: objects/transfer-quota]', async () => {
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
    const body = (await res.json()) as { error: { details: Array<{ reason: string }> } }
    expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
  })

  it('rejects transfer to the same space [spec: objects/transfer-same-space]', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'src-same', name: 'doc.txt' })

    const res = await transferRequest(app, headers, 'src-same', { targetOrgId: orgId, mode: 'copy' })
    expect(res.status).toBe(400)
  })
})

// ─── Quota enforcement ────────────────────────────────────────────────────────
// Scoped helpers below shadow the top-level fixtures (distinct storage id and a
// quota-focused insertStorage/insertFile signature) so they stay isolated.

describe('Objects API — quota enforcement', () => {
  const validStorage = {
    id: 'st-quota',
    bucket: 'test-bucket',
    endpoint: 'https://s3.amazonaws.com',
    region: 'us-east-1',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  }

  async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db'], used = 0) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
      VALUES (${validStorage.id}, ${validStorage.bucket},
              ${validStorage.endpoint}, ${validStorage.region}, ${validStorage.accessKey},
              ${validStorage.secretKey}, '', '', 0, ${used}, 'active', ${now}, ${now})
    `)
  }

  async function insertFile(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    orgId: string,
    opts: { id: string; name: string; size?: number; status?: string; trashedAt?: number },
  ) {
    const now = Date.now()
    const size = opts.size ?? 100
    const status = opts.status ?? 'active'
    await db.run(sql`
      INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, trashed_at, created_at, updated_at)
      VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', ${size}, 0, '',
              'some/key.txt', ${validStorage.id}, ${status}, ${opts.trashedAt ?? null}, ${now}, ${now})
    `)
  }

  async function getOrgId(db: Awaited<ReturnType<typeof createTestApp>>['db']): Promise<string> {
    const rows = await db.all<{ id: string }>(sql`
      SELECT id FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
    `)
    return rows[0].id
  }

  async function setOrgQuota(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    orgId: string,
    quota: number,
    used = 0,
  ) {
    const existing = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, orgId))
    if (existing.length > 0) {
      await db.update(orgQuotas).set({ quota, used }).where(eq(orgQuotas.orgId, orgId))
    } else {
      await db.insert(orgQuotas).values({
        id: nanoid(),
        orgId,
        quota,
        used,
        trafficQuota: 0,
        trafficUsed: 0,
        trafficPeriod: currentTrafficPeriod(),
      })
    }
    const now = Date.now()
    await db.run(sql`
      UPDATE org_quota_entitlements
      SET status = 'revoked', updated_at = ${now}
      WHERE org_id = ${orgId}
        AND resource_type = 'storage'
        AND entitlement_type = 'plan'
        AND status = 'active'
    `)
    if (quota > 0) {
      await db.run(sql`
        INSERT INTO org_quota_entitlements
          (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
        VALUES
          (${nanoid()}, ${orgId}, 'storage', 'plan', 'test', ${`test-storage-plan:${orgId}:${nanoid()}`}, ${quota}, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
      `)
    }
  }

  async function addStorageEntitlement(
    db: Awaited<ReturnType<typeof createTestApp>>['db'],
    orgId: string,
    bytes: number,
  ) {
    const now = new Date()
    await db.insert(orgQuotaEntitlements).values({
      id: nanoid(),
      orgId,
      resourceType: 'storage',
      source: 'test',
      sourceId: nanoid(),
      bytes,
      startsAt: now,
      expiresAt: null,
      status: 'active',
      metadata: null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ─── POST /api/objects/copy — quota enforcement ──────────────────────────

  describe('POST /api/objects/copy — quota enforcement', () => {
    it('returns 422 when copying a file would exceed quota', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      // quota = 500, used = 450, file size = 100 → copy would exceed
      await setOrgQuota(db, orgId, 500, 450)
      await insertFile(db, orgId, { id: 'm-copy-over', name: 'big.txt', size: 100 })

      const res = await app.request('/api/objects/m-copy-over/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })
      expect(res.status).toBe(422)
      const body = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
      expect(body.error.message).toBe('Quota exceeded')
      expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
    })

    it('returns 201 and increments orgQuotas.used when copy succeeds within quota', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      // quota = 1000, used = 100, file size = 100 → copy is fine
      await setOrgQuota(db, orgId, 1000, 100)
      await insertFile(db, orgId, { id: 'm-copy-ok', name: 'doc.txt', size: 100 })

      const res = await app.request('/api/objects/m-copy-ok/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })
      expect(res.status).toBe(201)

      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(quotaRows[0].used).toBe(200)
    })

    it('returns 201 and increments storages.used when copy succeeds', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 50)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 10000, 50)
      await insertFile(db, orgId, { id: 'm-copy-st', name: 'img.png', size: 150 })

      await app.request('/api/objects/m-copy-st/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })

      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      expect(storageRows[0].used).toBe(200)
    })

    it('rolls back usage when S3 copy fails after quota reservation', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 100)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 1000, 100)
      await insertFile(db, orgId, { id: 'm-copy-s3-fail', name: 'fail.txt', size: 200 })
      vi.mocked(S3Service.prototype.copyObject).mockRejectedValueOnce(new Error('copy failed'))

      const res = await app.request('/api/objects/m-copy-s3-fail/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: 'Archive' }),
      })

      expect(res.status).toBe(500)
      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(storageRows[0].used).toBe(100)
      expect(quotaRows[0].used).toBe(100)
    })

    it('rolls back usage when copy fails on name conflict after quota reservation', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 100)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 1000, 100)
      await insertFile(db, orgId, { id: 'm-copy-conflict', name: 'conflict.txt', size: 200 })

      const res = await app.request('/api/objects/m-copy-conflict/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '', onConflict: 'fail' }),
      })

      expect(res.status).toBe(409)
      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(storageRows[0].used).toBe(100)
      expect(quotaRows[0].used).toBe(100)
    })

    it('returns 201 without incrementing usage when copying a zero-size file', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      // quota is fully consumed, but zero-size should still pass
      await setOrgQuota(db, orgId, 500, 500)
      const now = Date.now()
      await db.run(sql`
        INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
        VALUES ('m-zero', ${orgId}, 'm-zero-alias', 'empty.txt', 'text/plain', 0, 0, '', '',
                ${validStorage.id}, 'active', ${now}, ${now})
      `)

      const res = await app.request('/api/objects/m-zero/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })
      expect(res.status).toBe(201)

      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(quotaRows[0].used).toBe(500) // unchanged
    })

    it('returns 422 when no quota row or entitlement exists', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await db.delete(orgQuotaEntitlements).where(eq(orgQuotaEntitlements.orgId, orgId))
      await db.delete(orgQuotas).where(eq(orgQuotas.orgId, orgId))
      await insertFile(db, orgId, { id: 'm-copy-nolimit', name: 'nolimit.txt', size: 100 })

      const res = await app.request('/api/objects/m-copy-nolimit/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })
      expect(res.status).toBe(422)
    })

    it('returns 422 when effective quota is zero', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 0, 99999)
      await insertFile(db, orgId, { id: 'm-copy-qlimit', name: 'large.bin', size: 1000000 })

      const res = await app.request('/api/objects/m-copy-qlimit/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })
      expect(res.status).toBe(422)
    })

    it('returns 404 when source file does not exist', async () => {
      const { app } = await createTestApp()
      const headers = await authedHeaders(app)

      const res = await app.request('/api/objects/nonexistent/copies', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: '' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('trash and purge — storage usage accounting', () => {
    it('does not change usage when an active file is moved to trash', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 300)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 1000, 300)
      await insertFile(db, orgId, { id: 'm-trash-usage', name: 'keep-accounted.txt', size: 300 })

      // Soft delete keeps trashed bytes counted (they still occupy storage).
      const res = await app.request('/api/objects/m-trash-usage', { method: 'DELETE', headers })

      expect(res.status).toBe(204)
      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(storageRows[0].used).toBe(300)
      expect(quotaRows[0].used).toBe(300)
    })

    it('purging a trashed root releases only its bytes and keeps active file usage', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 500)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 1000, 500)
      await insertFile(db, orgId, { id: 'm-active-after-empty', name: 'active.txt', size: 300 })
      await insertFile(db, orgId, { id: 'm-trashed-empty', name: 'trashed.txt', size: 200, trashedAt: Date.now() })

      const res = await app.request('/api/trash/objects/m-trashed-empty', { method: 'DELETE', headers })

      expect(res.status).toBe(204)
      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(storageRows[0].used).toBe(300)
      expect(quotaRows[0].used).toBe(300)
    })

    it('purging a trashed root recalculates usage when counters had drifted below active file bytes', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 200)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 1000, 200)
      await insertFile(db, orgId, { id: 'm-active-drift', name: 'active.txt', size: 300 })
      await insertFile(db, orgId, { id: 'm-trashed-drift', name: 'trashed.txt', size: 200, trashedAt: Date.now() })

      const res = await app.request('/api/trash/objects/m-trashed-drift', { method: 'DELETE', headers })

      expect(res.status).toBe(204)
      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(storageRows[0].used).toBe(300)
      expect(quotaRows[0].used).toBe(300)
    })
  })

  describe('GET /api/objects/:id — traffic quota enforcement', () => {
    it('returns download URL and consumes traffic quota when allowed', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await insertFile(db, orgId, { id: 'm-download-ok', name: 'download.txt', size: 100 })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 500, traffic_used = 25, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)

      const res = await app.request('/api/objects/m-download-ok', { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.downloadUrl).toBe('https://presigned-download.example.com')

      const rows = await db.all<{ trafficUsed: number }>(
        sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(rows[0].trafficUsed).toBe(125)
    })

    it('resets stale monthly traffic period before consuming traffic', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await insertFile(db, orgId, { id: 'm-download-reset', name: 'download.txt', size: 100 })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 500, traffic_used = 500, traffic_period = '1970-01'
        WHERE org_id = ${orgId}
      `)

      const res = await app.request('/api/objects/m-download-reset', { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.downloadUrl).toBe('https://presigned-download.example.com')

      const rows = await db.all<{ trafficUsed: number; trafficPeriod: string }>(
        sql`SELECT traffic_used AS trafficUsed, traffic_period AS trafficPeriod FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(rows[0]).toEqual({ trafficUsed: 100, trafficPeriod })
    })

    it('refunds traffic when download URL signing fails', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await insertFile(db, orgId, { id: 'm-download-sign-fail', name: 'download.txt', size: 100 })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 500, traffic_used = 25, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)
      vi.mocked(S3Service.prototype.presignDownload).mockRejectedValueOnce(new Error('sign failed'))

      const res = await app.request('/api/objects/m-download-sign-fail', { headers })
      expect(res.status).toBe(500)

      const rows = await db.all<{ trafficUsed: number }>(
        sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(rows[0].trafficUsed).toBe(25)
    })

    it('returns 422 when download traffic quota is exhausted', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await insertFile(db, orgId, { id: 'm-download-over', name: 'download.txt', size: 100 })
      const trafficPeriod = currentTrafficPeriod()
      await db.run(sql`
        UPDATE org_quotas
        SET traffic_quota = 0, traffic_used = 0, traffic_period = ${trafficPeriod}
        WHERE org_id = ${orgId}
      `)
      const now = Date.now()
      await db.run(sql`
        UPDATE org_quota_entitlements
        SET status = 'revoked', updated_at = ${now}
        WHERE org_id = ${orgId}
          AND resource_type = 'traffic'
          AND entitlement_type = 'plan'
          AND status = 'active'
      `)
      await db.run(sql`
        INSERT INTO org_quota_entitlements
          (id, org_id, resource_type, entitlement_type, source, source_id, bytes, starts_at, expires_at, status, metadata, created_at, updated_at)
        VALUES
          (${nanoid()}, ${orgId}, 'traffic', 'plan', 'test', ${`test-traffic-plan:${orgId}`}, 50, ${now}, NULL, 'active', '{"packageName":"Test Plan"}', ${now}, ${now})
      `)

      const res = await app.request('/api/objects/m-download-over', { headers })
      expect(res.status).toBe(422)
      const body = (await res.json()) as {
        error: { message: string; status: string; details: Array<{ reason: string }> }
      }
      expect(body.error.message).toBe('Traffic quota exceeded')
      expect(body.error.status).toBe('RESOURCE_EXHAUSTED')
      expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
      expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()

      const rows = await db.all<{ trafficUsed: number }>(
        sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(rows[0].trafficUsed).toBe(0)
      const failures = await db.all<{ bytes: number; reason: string; source: string }>(sql`
        SELECT json_extract(metadata, '$.bytes') AS bytes,
          json_extract(metadata, '$.reason') AS reason,
          json_extract(metadata, '$.source') AS source
        FROM audit_events
        WHERE action = 'download_failed' AND target_id = 'm-download-over'
      `)
      expect(failures).toEqual([{ bytes: 100, reason: 'quota_exceeded', source: 'object_download' }])
    })
  })

  // ─── POST .../completions — quota enforcement via the activation path ──────────
  // The completions endpoint finalizes a draft (draft → live), reserving quota
  // through the same confirmUpload core. These tests drive the real upload flow:
  // POST /api/objects (creates the draft + session) then POST .../completions.

  describe('POST .../completions — quota enforcement', () => {
    // Creates a file draft via the API and returns {id, sessionId}. The S3 spies
    // make the single-PUT HEAD return etag 'abc'.
    async function createDraft(
      app: Awaited<ReturnType<typeof createTestApp>>['app'],
      headers: Record<string, string>,
      body: { name: string; size: number; onConflict?: string },
    ): Promise<{ id: string; sessionId: string }> {
      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text/plain', parent: '', dirtype: 0, ...body }),
      })
      if (res.status !== 201) throw new Error(`create failed: ${res.status} ${await res.text()}`)
      const created = (await res.json()) as { id: string; upload: { sessionId: string } }
      return { id: created.id, sessionId: created.upload.sessionId }
    }
    // The conflict strategy is fixed at create time (stored on the session); the
    // completions body carries only the uploaded parts.
    function complete(
      app: Awaited<ReturnType<typeof createTestApp>>['app'],
      headers: Record<string, string>,
      ref: { id: string; sessionId: string },
    ) {
      return app.request(`/api/objects/${ref.id}/uploads/${ref.sessionId}/completions`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
      })
    }

    it('returns 200 and increments usage when quota allows', async () => {
      const { app, db } = await createTestApp()
      await seedProLicense(db)
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 10000, 0)
      const ref = await createDraft(app, headers, { name: 'uploading.txt', size: 350 })

      const res = await complete(app, headers, ref)
      expect(res.status).toBe(200)
      const body = (await res.json()) as Record<string, unknown>
      expect(body.status).toBe('active')

      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(quotaRows[0].used).toBe(350)
    })

    it('uses active storage entitlements when finalizing upload', async () => {
      const { app, db } = await createTestApp()
      await seedProLicense(db)
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 100, 90)
      await addStorageEntitlement(db, orgId, 100)
      const ref = await createDraft(app, headers, { name: 'entitled.txt', size: 50 })

      const res = await complete(app, headers, ref)
      expect(res.status).toBe(200)
      const quotaRows = await db.all<{ used: number; quota: number }>(
        sql`SELECT used, quota FROM org_quotas WHERE org_id = ${orgId}`,
      )
      expect(quotaRows[0]).toEqual({ used: 140, quota: 100 })
    })

    it('enforces storage entitlements when the legacy quota column is zero', async () => {
      const { app, db } = await createTestApp()
      await seedProLicense(db)
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 0, 90)
      await addStorageEntitlement(db, orgId, 100)
      const ref = await createDraft(app, headers, { name: 'limited.txt', size: 11 })

      const res = await complete(app, headers, ref)
      expect(res.status).toBe(422)
      await expect(res.json()).resolves.toMatchObject({ error: { message: 'Quota exceeded' } })
    })

    it('returns 200 and increments storages.used when quota allows', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 100)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 10000, 100)
      const ref = await createDraft(app, headers, { name: 'photo.jpg', size: 400 })

      await complete(app, headers, ref)

      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      expect(storageRows[0].used).toBe(500)
    })

    it('returns 422 when finalizing upload would exceed quota', async () => {
      const { app, db } = await createTestApp()
      await seedProLicense(db)
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      // quota = 100, used = 90, file size = 50 → exceeds
      await setOrgQuota(db, orgId, 100, 90)
      const ref = await createDraft(app, headers, { name: 'toobig.txt', size: 50 })

      const res = await complete(app, headers, ref)
      expect(res.status).toBe(422)
      const body = (await res.json()) as { error: { message: string; details: Array<{ reason: string }> } }
      expect(body.error.message).toBe('Quota exceeded')
      expect(body.error.details[0].reason).toBe('QUOTA_EXCEEDED')
    })

    it('does not change usage when a file with size 0 is finalized', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db, 50)
      const orgId = await getOrgId(db)
      await setOrgQuota(db, orgId, 10000, 50)
      // HEAD returns size 0 for the empty file; the reported etag still matches.
      vi.mocked(S3Service.prototype.headObject).mockResolvedValue({ size: 0, contentType: 'text/plain', etag: 'abc' })
      const ref = await createDraft(app, headers, { name: 'empty.txt', size: 0 })

      await complete(app, headers, ref)

      const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${validStorage.id}`)
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(storageRows[0].used).toBe(50)
      expect(quotaRows[0].used).toBe(50)
    })

    it('returns 422 when no quota row or entitlement exists', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await db.delete(orgQuotaEntitlements).where(eq(orgQuotaEntitlements.orgId, orgId))
      await db.delete(orgQuotas).where(eq(orgQuotas.orgId, orgId))
      const ref = await createDraft(app, headers, { name: 'nolimit.txt', size: 5000 })

      const res = await complete(app, headers, ref)
      expect(res.status).toBe(422)
      await expect(res.json()).resolves.toMatchObject({ error: { details: [{ reason: 'QUOTA_EXCEEDED' }] } })
    })

    it('replaces a same-size file at full quota — net-neutral, incumbent purged', async () => {
      const { app, db } = await createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      // Quota exactly full: the 100-byte incumbent fills the 100-byte quota.
      await insertFile(db, orgId, { id: 'incumbent', name: 'doc.txt', size: 100 })
      await setOrgQuota(db, orgId, 100, 100)

      // Create the replacement draft with onConflict:'replace' (stored on the
      // session; incumbent stays active — overwrite deferred to completion).
      const ref = await createDraft(app, headers, { name: 'doc.txt', size: 100, onConflict: 'replace' })

      // Complete: the incumbent's bytes are freed so this is net-neutral.
      const completeRes = await complete(app, headers, ref)
      expect(completeRes.status).toBe(200)

      // Incumbent content is purged but its tombstone is retained; usage is unchanged.
      const incumbent = await db.all<{ purgedAt: number | null }>(
        sql`SELECT purged_at AS purgedAt FROM matters WHERE id = 'incumbent'`,
      )
      expect(incumbent[0]?.purgedAt).toEqual(expect.any(Number))
      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(quotaRows[0].used).toBe(100)
    })
  })
})

// ─── Multipart upload against a live S3-compatible mock ───────────────────────
// Self-contained: spins up an in-process S3 mock and uses its own storage row.

describe('object multipart upload API with S3-compatible storage', () => {
  let server: Server | undefined

  // Undo the file-level S3Service spies so this test exercises the real gateway
  // against its in-process mock instead of the stubbed presign URLs.
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db'], endpoint: string) {
    const now = Date.now()
    await db.run(sql`
      INSERT INTO storages (
        id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
        capacity, used, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
        egress_credit_per_unit, created_at, updated_at
      )
      VALUES (
        'multipart-live-storage', 'test-bucket',
        ${endpoint}, 'auto', 'test-access-key', 'test-secret-key',
        '$UID/$RAW_NAME', '', 0, 0, 'active', 0, ${100 * 1024 * 1024}, 1, ${now}, ${now}
      )
    `)
  }

  async function startMultipartS3Mock(): Promise<{ endpoint: string; server: Server }> {
    const objects = new Map<string, Uint8Array>()
    const uploads = new Map<string, { bucket: string; key: string; parts: Map<number, Uint8Array> }>()
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
        const { bucket, key } = parsePath(url.pathname)
        const objectKey = `${bucket}/${key}`

        if (req.method === 'POST' && url.searchParams.has('uploads')) {
          const uploadId = randomUUID()
          uploads.set(uploadId, { bucket, key, parts: new Map() })
          res.writeHead(200, { 'Content-Type': 'application/xml' })
          res.end(`<CreateMultipartUploadResult><UploadId>${uploadId}</UploadId></CreateMultipartUploadResult>`)
          return
        }

        if (req.method === 'PUT' && url.searchParams.has('uploadId') && url.searchParams.has('partNumber')) {
          const upload = uploads.get(url.searchParams.get('uploadId') ?? '')
          if (!upload) {
            res.writeHead(404)
            res.end('Upload not found')
            return
          }
          const body = await readBody(req)
          upload.parts.set(Number(url.searchParams.get('partNumber')), body)
          res.writeHead(200, { etag: etag(body) })
          res.end('')
          return
        }

        if (req.method === 'POST' && url.searchParams.has('uploadId')) {
          const uploadId = url.searchParams.get('uploadId') ?? ''
          const upload = uploads.get(uploadId)
          if (!upload) {
            res.writeHead(404)
            res.end('Upload not found')
            return
          }
          const parts = [...upload.parts.entries()].sort(([left], [right]) => left - right)
          const body = concat(parts.map(([, part]) => part))
          objects.set(`${upload.bucket}/${upload.key}`, body)
          uploads.delete(uploadId)
          res.writeHead(200, { 'Content-Type': 'application/xml' })
          res.end('<CompleteMultipartUploadResult />')
          return
        }

        // Single PutObject (≤5 GiB upload): store the body and return its ETag.
        if (req.method === 'PUT') {
          const body = await readBody(req)
          objects.set(objectKey, body)
          res.writeHead(200, { etag: etag(body) })
          res.end('')
          return
        }

        // HeadObject — completions HEADs the object to confirm the single-PUT ETag.
        if (req.method === 'HEAD') {
          const object = objects.get(objectKey)
          if (!object) {
            res.writeHead(404)
            res.end('')
            return
          }
          res.writeHead(200, { 'Content-Length': object.byteLength, etag: etag(object) })
          res.end('')
          return
        }

        if (req.method === 'GET') {
          const object = objects.get(objectKey)
          if (!object) {
            res.writeHead(404)
            res.end('Not found')
            return
          }
          res.writeHead(200, { 'Content-Length': object.byteLength, etag: etag(object) })
          res.end(object)
          return
        }

        res.writeHead(405)
        res.end('Method not allowed')
      } catch (error) {
        res.writeHead(500)
        res.end(error instanceof Error ? error.message : String(error))
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('S3 mock did not bind to a TCP port')
    return { endpoint: `http://127.0.0.1:${address.port}`, server }
  }

  function parsePath(pathname: string): { bucket: string; key: string } {
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
    return { bucket: parts[0] ?? '', key: parts.slice(1).join('/') }
  }

  async function readBody(req: IncomingMessage): Promise<Uint8Array> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return new Uint8Array(Buffer.concat(chunks))
  }

  function concat(parts: Uint8Array[]): Uint8Array {
    const body = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
    let offset = 0
    for (const part of parts) {
      body.set(part, offset)
      offset += part.byteLength
    }
    return body
  }

  function etag(body: Uint8Array): string {
    return `"${createHash('md5').update(body).digest('hex')}"`
  }

  afterEach(async () => {
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()))
    })
    server = undefined
  })

  it('uploads a small object end-to-end via the single-PUT flow against a live S3 mock', async () => {
    const s3 = await startMultipartS3Mock()
    server = s3.server
    const { app, db } = await createTestApp()
    await insertStorage(db, s3.endpoint)
    const headers = await authedHeaders(app)

    // ≤5 GiB → one presigned PUT URL and partSize === size.
    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'upload-smoke.txt',
        type: 'text/plain',
        size: 11,
        parent: '',
      }),
    })
    expect(createRes.status).toBe(201)
    const object = (await createRes.json()) as {
      id: string
      upload: { sessionId: string; partSize: number; urls: string[] }
    }
    expect(object.upload.urls).toHaveLength(1)
    expect(object.upload.partSize).toBe(11)

    // PUT the bytes directly to the presigned URL, read the ETag.
    const putRes = await fetch(object.upload.urls[0], { method: 'PUT', body: 'hello world' })
    expect(putRes.status).toBe(200)
    const etagHeader = putRes.headers.get('etag')
    expect(etagHeader).toBeTruthy()

    // Finalize: completions HEADs the object and matches the reported ETag.
    const completeRes = await app.request(`/api/objects/${object.id}/uploads/${object.upload.sessionId}/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: etagHeader }] }),
    })
    expect(completeRes.status).toBe(200)
    expect(((await completeRes.json()) as { status: string }).status).toBe('active')

    const objectRes = await app.request(`/api/objects/${object.id}`, { headers })
    expect(objectRes.status).toBe(200)
    const active = (await objectRes.json()) as { downloadUrl: string }
    const downloadRes = await fetch(active.downloadUrl)
    expect(downloadRes.status).toBe(200)
    await expect(downloadRes.text()).resolves.toBe('hello world')
  })
})

// ─── Error-branch coverage (AIP-193 bodies) ───────────────────────────────────
// These exercise the inline `apiError(...)` guards in the handlers that the
// happy-path tests above don't reach: cross-org list authz, missing-storage
// resolution, the download-task-upload confirm guards, and the editor-access
// gate for a user-scoped (orgId-less) API key principal.

// Creates an API key via the real better-auth plugin. A `webdav` config-id key
// is user-scoped, so the auth middleware resolves it with userId set and orgId
// null — the exact state the editor-access gate denies.
async function createUserApiKey(
  auth: Awaited<ReturnType<typeof createTestApp>>['auth'],
  userId: string,
): Promise<string> {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: { configId: 'webdav', userId },
  })) as { key: string }
  return result.key
}

const downloaderHeartbeat = {
  version: '1.0.0',
  hostname: 'host',
  platform: 'linux',
  arch: 'x64',
  engine: 'aria2',
  capabilities: ['http', 'magnet', 'torrent'],
  maxConcurrentTasks: 2,
  currentTasks: 0,
  downloadBps: 0,
  uploadBps: 0,
  freeDiskBytes: 1024 * 1024 * 1024,
}

// Registers a downloader, creates a task, lets heartbeat claim it, and returns
// the upload token plus the task's target folder. The token authenticates as a
// `download-task-upload` principal scoped to that task/folder.
async function mintTaskUploadContext(
  app: TestApp,
  db: TestDb,
  opts: { targetFolder: string },
): Promise<{ uploadToken: string; targetFolder: string; orgId: string }> {
  const admin = await adminHeaders(app)
  const codeRes = await app.request('/api/auth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'zpan-cli', scope: 'downloader:register' }),
  })
  const code = (await codeRes.json()) as { device_code: string; user_code: string }
  await app.request(`/api/auth/device?user_code=${encodeURIComponent(code.user_code)}`, { headers: admin })
  await app.request('/api/auth/device/approve', {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userCode: code.user_code }),
  })
  const tokenRes = await app.request('/api/auth/device/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: code.device_code,
      client_id: 'zpan-cli',
    }),
  })
  const cliToken = (await tokenRes.json()) as { access_token: string }
  const downloaderHeaders = { Authorization: `Bearer ${cliToken.access_token}`, 'Content-Type': 'application/json' }
  const createDownloaderRes = await app.request('/api/downloads/downloaders', {
    method: 'POST',
    headers: downloaderHeaders,
    body: JSON.stringify({ name: 'object-error-downloader', heartbeat: downloaderHeartbeat }),
  })
  const downloader = (await createDownloaderRes.json()) as { token: string }
  await app.request('/api/downloads/downloaders/me/heartbeats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${downloader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...downloaderHeartbeat, currentTasks: 0 }),
  })

  const user = await adminHeaders(app)
  const createTaskRes = await app.request('/api/downloads/tasks', {
    method: 'POST',
    headers: { ...user, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: { type: 'http', uri: 'https://example.com/file.txt' },
      targetFolder: opts.targetFolder,
      name: 'file.txt',
    }),
  })
  expect(createTaskRes.status).toBe(201)

  const assignedRes = await app.request('/api/downloads/downloaders/me/heartbeats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${downloader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...downloaderHeartbeat, currentTasks: 0 }),
  })
  const assigned = (await assignedRes.json()) as {
    assignments: Array<{ status: { assignment?: { uploadToken?: string } } }>
  }
  const uploadToken = assigned.assignments[0]?.status.assignment?.uploadToken
  if (!uploadToken) throw new Error('upload_token_missing')
  const orgRows = await db.all<{ orgId: string }>(sql`SELECT org_id AS orgId FROM download_tasks LIMIT 1`)
  return { uploadToken, targetFolder: opts.targetFolder, orgId: orgRows[0].orgId }
}

describe('Objects API — error branches', () => {
  it('accepts a download-task-upload token scoped to a Unicode target folder', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const targetFolder = 'Media/Music/欧阳娜娜/NANA II (2020)'
    const { uploadToken } = await mintTaskUploadContext(app, db, { targetFolder })

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${uploadToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '藏.mp3',
        type: 'audio/mpeg',
        size: 1,
        parent: targetFolder,
      }),
    })

    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({
      name: '藏.mp3',
      parent: targetFolder,
    })
  })

  it('returns 403 for a user-scoped API key with no active org on write', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await insertStorage(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    const key = await createUserApiKey(auth, userId)

    const res = await app.request('/api/objects', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'denied.txt', type: 'text/plain', size: 1 }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Forbidden')
    expect(body.error.status).toBe('PERMISSION_DENIED')
  })

  it('returns 403 when listing an org the user cannot read via orgId override', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    await insertTeamOrg(db, 'team-foreign')

    const res = await app.request('/api/objects?orgId=team-foreign', { headers })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string; status: string } }
    expect(body.error.message).toBe('Forbidden')
    expect(body.error.status).toBe('PERMISSION_DENIED')
  })

  it('returns 404 when a file references a missing storage on GET', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    // File with a non-empty object key but no matching storage row.
    await insertFile(db, orgId, { id: 'm-no-storage', name: 'orphan.txt' })

    const res = await app.request('/api/objects/m-no-storage', { headers })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Storage not found')
  })

  it('returns 404 when copying a file whose storage is missing', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    const orgId = await getOrgId(db)
    await insertFile(db, orgId, { id: 'm-copy-orphan', name: 'orphan.txt' })

    const res = await app.request('/api/objects/m-copy-orphan/copies', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: '' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Storage not found')
  })

  it('returns 404 when transferring a missing object', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app)
    await insertStorage(db)
    const userId = await getUserIdByEmail(db, 'test@example.com')
    await insertTeamOrg(db, 'team-dest')
    await insertMember(db, 'team-dest', userId, 'editor')

    const res = await transferRequest(app, headers, 'does-not-exist', { targetOrgId: 'team-dest', mode: 'copy' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Not found')
  })

  it('rejects a download-task-upload token that tries to soft-delete (trash) an object', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const { uploadToken, orgId } = await mintTaskUploadContext(app, db, { targetFolder: 'Remote' })
    await insertFile(db, orgId, { id: 'm-task-trash', name: 'file.txt', parent: 'Remote' })

    // DELETE /objects/:id is editor-gated; a download-task-upload token has no
    // team role (userId is null) so it is rejected — it may only finalize uploads.
    const res = await app.request('/api/objects/m-task-trash', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${uploadToken}` },
    })
    expect(res.status).toBe(401)
  })

  it('rejects a download-task-upload completion outside the task target folder', async () => {
    const { app, db } = await createTestApp({ DOWNLOAD_TOKEN_SECRET: 'test-download-token-secret' })
    await insertStorage(db)
    const { uploadToken, orgId } = await mintTaskUploadContext(app, db, { targetFolder: 'Remote' })
    // Draft sits outside the token's authorized folder, so the completion guard denies
    // before any session lookup.
    await insertFile(db, orgId, { id: 'm-task-outside', name: 'file.txt', parent: 'Elsewhere', status: 'draft' })

    const res = await app.request('/api/objects/m-task-outside/uploads/any-session/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${uploadToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ partNumber: 1, etag: 'abc' }] }),
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Forbidden')
  })
})
