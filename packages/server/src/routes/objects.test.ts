import { sql } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

const mockSend = vi.fn().mockResolvedValue({ ContentLength: 1024, ContentType: 'image/jpeg' })

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = mockSend
  }
  class MockPutObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockGetObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockHeadObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockCopyObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockDeleteObjectCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class MockDeleteObjectsCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  return {
    S3Client: MockS3Client,
    PutObjectCommand: MockPutObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
    HeadObjectCommand: MockHeadObjectCommand,
    CopyObjectCommand: MockCopyObjectCommand,
    DeleteObjectCommand: MockDeleteObjectCommand,
    DeleteObjectsCommand: MockDeleteObjectsCommand,
  }
})

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned'),
}))

async function insertStorage(db: ReturnType<typeof createTestApp>['db']) {
  const now = Math.floor(Date.now() / 1000)
  await db.run(
    sql`INSERT INTO storages (id, uid, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, status, created_at, updated_at)
        VALUES ('s1', 'system', 'Default', 'private', 'test-bucket', 'https://s3.example.com', 'auto', 'key', 'secret', '$UID/$RAW_NAME$RAW_EXT', '', 1, ${now}, ${now})`,
  )
}

async function insertQuota(db: ReturnType<typeof createTestApp>['db'], orgId: string, quota = 1073741824) {
  await db.run(sql`INSERT INTO org_quotas (id, org_id, quota, used) VALUES ('q1', ${orgId}, ${quota}, 0)`)
}

async function getOrgId(db: ReturnType<typeof createTestApp>['db']) {
  const orgs = await db.all<{ id: string }>(
    sql`SELECT o.id FROM organization o WHERE o.metadata LIKE '%"type":"personal"%' LIMIT 1`,
  )
  return orgs[0].id
}

describe('Objects API', () => {
  it('returns 401 without auth', async () => {
    const { app } = createTestApp()
    const res = await app.request('/api/objects')
    expect(res.status).toBe(401)
  })

  describe('GET /api/objects', () => {
    it('returns empty list when no objects exist', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects', { headers })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    })

    it('respects pagination params', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects?page=2&pageSize=10', { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { page: number; pageSize: number }
      expect(body.page).toBe(2)
      expect(body.pageSize).toBe(10)
    })

    it('filters by parent param', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m1', ${orgId}, 'alias1', 'root-folder', 'folder', 0, 1, '', '', '', 'active', ${now}, ${now})`,
      )
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m2', ${orgId}, 'alias2', 'child-folder', 'folder', 0, 1, 'alias1', '', '', 'active', ${now}, ${now})`,
      )

      const rootRes = await app.request('/api/objects', { headers })
      const rootBody = (await rootRes.json()) as { total: number }
      expect(rootBody.total).toBe(1)

      const childRes = await app.request('/api/objects?parent=alias1', { headers })
      const childBody = (await childRes.json()) as { total: number }
      expect(childBody.total).toBe(1)
    })

    it('returns folders before files (dirtype DESC order)', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('file1', ${orgId}, 'falias1', 'a-file.txt', 'text/plain', 100, 0, '', 'key', 's1', 'active', ${now}, ${now})`,
      )
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('dir1', ${orgId}, 'dalias1', 'z-folder', 'folder', 0, 1, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects', { headers })
      const body = (await res.json()) as { items: Array<{ name: string; dirtype: number }> }
      expect(body.items[0].dirtype).toBe(1)
      expect(body.items[0].name).toBe('z-folder')
      expect(body.items[1].dirtype).toBe(0)
    })
  })

  describe('POST /api/objects — create folder', () => {
    it('creates folder with status active and dirtype 1', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Folder', parent: '', dirtype: 1 }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { matter: { name: string; dirtype: number; status: string } }
      expect(body.matter.name).toBe('My Folder')
      expect(body.matter.dirtype).toBe(1)
      expect(body.matter.status).toBe('active')
    })

    it('creates folder with nested parent', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sub Folder', parent: 'some-alias', dirtype: 1 }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { matter: { parent: string } }
      expect(body.matter.parent).toBe('some-alias')
    })

    it('does not return uploadUrl for folder', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Folder', parent: '', dirtype: 1 }),
      })
      const body = (await res.json()) as { uploadUrl?: string }
      expect(body.uploadUrl).toBeUndefined()
    })
  })

  describe('POST /api/objects — create file', () => {
    it('returns 400 when no storage is available', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'file.txt', size: 100, type: 'text/plain', parent: '' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/No storage available/)
    })

    it('creates file with status draft and returns uploadUrl', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)

      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'photo.jpg', size: 1024, type: 'image/jpeg', parent: '' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { matter: { name: string; status: string }; uploadUrl: string }
      expect(body.matter.name).toBe('photo.jpg')
      expect(body.matter.status).toBe('draft')
      expect(body.uploadUrl).toBe('https://s3.example.com/presigned')
    })

    it('returns 413 when storage quota is exceeded', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await insertQuota(db, orgId, 100) // 100 byte quota
      await db.run(sql`UPDATE org_quotas SET used = 90 WHERE org_id = ${orgId}`)

      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'big.jpg', size: 200, type: 'image/jpeg', parent: '' }),
      })
      expect(res.status).toBe(413)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/quota exceeded/)
    })

    it('creates file when within quota', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)
      const orgId = await getOrgId(db)
      await insertQuota(db, orgId, 1073741824)

      const res = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ok.jpg', size: 1024, type: 'image/jpeg', parent: '' }),
      })
      expect(res.status).toBe(201)
    })
  })

  describe('PATCH /api/objects/:id/done — confirm upload', () => {
    it('changes file status from draft to active', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)

      const createRes = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'upload.jpg', size: 512, type: 'image/jpeg', parent: '' }),
      })
      const { matter } = (await createRes.json()) as { matter: { id: string; status: string } }
      expect(matter.status).toBe('draft')

      const doneRes = await app.request(`/api/objects/${matter.id}/done`, {
        method: 'PATCH',
        headers,
      })
      expect(doneRes.status).toBe(200)
      const doneMatter = (await doneRes.json()) as { status: string }
      expect(doneMatter.status).toBe('active')
    })

    it('returns 400 when confirming an already active file', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      await insertStorage(db)

      const createRes = await app.request('/api/objects', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'upload2.jpg', size: 512, type: 'image/jpeg', parent: '' }),
      })
      const { matter } = (await createRes.json()) as { matter: { id: string } }

      // Confirm once
      await app.request(`/api/objects/${matter.id}/done`, { method: 'PATCH', headers })

      // Confirm again — should fail
      const res = await app.request(`/api/objects/${matter.id}/done`, { method: 'PATCH', headers })
      expect(res.status).toBe(400)
    })

    it('returns 400 when confirming a folder', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('folder1', ${orgId}, 'falias', 'MyFolder', 'folder', 0, 1, '', '', '', 'draft', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/folder1/done', { method: 'PATCH', headers })
      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent matter', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects/nonexistent/done', { method: 'PATCH', headers })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/objects/:id — get detail', () => {
    it('returns matter and downloadUrl for a file', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await insertStorage(db)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('file1', ${orgId}, 'falias1', 'photo.jpg', 'image/jpeg', 2048, 0, '', 'path/photo.jpg', 's1', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/file1', { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { matter: { id: string }; downloadUrl: string }
      expect(body.matter.id).toBe('file1')
      expect(body.downloadUrl).toBe('https://s3.example.com/presigned')
    })

    it('returns empty downloadUrl for a folder', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('dir1', ${orgId}, 'dalias1', 'MyDir', 'folder', 0, 1, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/dir1', { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { downloadUrl: string }
      expect(body.downloadUrl).toBe('')
    })

    it('returns a public URL when storage mode is public', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO storages (id, uid, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, status, created_at, updated_at)
            VALUES ('s-pub', 'system', 'Public', 'public', 'test-bucket', 'https://s3.example.com', 'auto', 'key', 'secret', '$UID/$RAW_NAME$RAW_EXT', 'https://cdn.example.com', 1, ${now}, ${now})`,
      )
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('pub-file', ${orgId}, 'pub-alias', 'public.jpg', 'image/jpeg', 1024, 0, '', 'path/public.jpg', 's-pub', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/pub-file', { headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { downloadUrl: string }
      expect(body.downloadUrl).toBeTruthy()
    })

    it('returns 404 for non-existent matter', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects/nonexistent', { headers })
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/objects/:id — rename or move', () => {
    it('renames a matter by updating its name', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m1', ${orgId}, 'al1', 'old-name.txt', 'text/plain', 0, 0, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/m1', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name.txt' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string }
      expect(body.name).toBe('new-name.txt')
    })

    it('moves a matter by updating its parent', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m2', ${orgId}, 'al2', 'file.txt', 'text/plain', 0, 0, '', '', '', 'active', ${now}, ${now})`,
      )
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('d1', ${orgId}, 'dest-alias', 'Destination', 'folder', 0, 1, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/m2', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: 'dest-alias' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { parent: string }
      expect(body.parent).toBe('dest-alias')
    })

    it('returns 400 when no update fields are provided', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m3', ${orgId}, 'al3', 'file.txt', 'text/plain', 0, 0, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/m3', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it('renames and moves a matter when both name and parent are provided', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m-combo', ${orgId}, 'al-combo', 'original.txt', 'text/plain', 0, 0, '', '', '', 'active', ${now}, ${now})`,
      )
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('d-combo', ${orgId}, 'dest-combo', 'DestFolder', 'folder', 0, 1, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/m-combo', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'renamed.txt', parent: 'dest-combo' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { name: string; parent: string }
      expect(body.name).toBe('renamed.txt')
      expect(body.parent).toBe('dest-combo')
    })

    it('returns 404 when moving to a non-existent parent folder', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('m-move404', ${orgId}, 'al-move404', 'file.txt', 'text/plain', 0, 0, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/m-move404', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: 'nonexistent-alias' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 404 for non-existent matter', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects/nonexistent', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('POST /api/objects/:id/copy', () => {
    it('creates a new matter row as a copy of the source file', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await insertStorage(db)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('src1', ${orgId}, 'src-alias', 'source.jpg', 'image/jpeg', 512, 0, '', 'path/source.jpg', 's1', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/src1/copy', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string; name: string; status: string }
      expect(body.name).toBe('source.jpg')
      expect(body.status).toBe('active')
      expect(body.id).not.toBe('src1')
    })

    it('returns 400 when trying to copy a folder', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('dir2', ${orgId}, 'dir-alias', 'AFolder', 'folder', 0, 1, '', '', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/dir2/copy', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/Folder copy is not supported/)
    })

    it('copies to specified parent', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await insertStorage(db)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('src2', ${orgId}, 'src2-alias', 'source2.jpg', 'image/jpeg', 256, 0, '', 'path/source2.jpg', 's1', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/src2/copy', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent: 'new-parent' }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { parent: string }
      expect(body.parent).toBe('new-parent')
    })

    it('returns 413 when copy would exceed storage quota', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await insertStorage(db)
      await insertQuota(db, orgId, 1000)
      await db.run(sql`UPDATE org_quotas SET used = 900 WHERE org_id = ${orgId}`)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('src-quota', ${orgId}, 'src-quota-alias', 'large.jpg', 'image/jpeg', 200, 0, '', 'path/large.jpg', 's1', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/src-quota/copy', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(413)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/quota exceeded/)
    })

    it('copies a file when storage has no filePath set (uses default template)', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO storages (id, uid, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, status, created_at, updated_at)
            VALUES ('s-nopath', 'system', 'NoPath', 'private', 'test-bucket', 'https://s3.example.com', 'auto', 'key', 'secret', '', '', 1, ${now}, ${now})`,
      )
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('src-nopath', ${orgId}, 'src-nopath-alias', 'nopath.jpg', 'image/jpeg', 100, 0, '', 'path/nopath.jpg', 's-nopath', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/src-nopath/copy', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { name: string }
      expect(body.name).toBe('nopath.jpg')
    })
  })

  describe('DELETE /api/objects/:id', () => {
    it('permanently deletes a trashed file', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await insertStorage(db)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('del1', ${orgId}, 'del-alias', 'to-delete.jpg', 'image/jpeg', 100, 0, '', 'path/to-delete.jpg', 's1', 'active', ${now}, ${now})`,
      )
      await db.run(sql`UPDATE matters SET status = 'trashed' WHERE id = 'del1'`)

      const res = await app.request('/api/objects/del1', { method: 'DELETE', headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)

      const rows = await db.all<{ id: string }>(sql`SELECT id FROM matters WHERE id = 'del1'`)
      expect(rows).toHaveLength(0)
    })

    it('returns 400 when deleting a non-trashed (active) file', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('del2', ${orgId}, 'del2-alias', 'active-file.jpg', 'image/jpeg', 100, 0, '', 'path/active.jpg', '', 'active', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/del2', { method: 'DELETE', headers })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toMatch(/Only trashed/)
    })

    it('returns 404 for non-existent matter', async () => {
      const { app } = createTestApp()
      const headers = await authedHeaders(app)
      const res = await app.request('/api/objects/nonexistent', { method: 'DELETE', headers })
      expect(res.status).toBe(404)
    })

    it('permanently deletes a trashed folder without calling S3', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('del-folder', ${orgId}, 'del-folder-alias', 'OldFolder', 'folder', 0, 1, '', '', '', 'trashed', ${now}, ${now})`,
      )

      const res = await app.request('/api/objects/del-folder', { method: 'DELETE', headers })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { ok: boolean }
      expect(body.ok).toBe(true)

      const rows = await db.all<{ id: string }>(sql`SELECT id FROM matters WHERE id = 'del-folder'`)
      expect(rows).toHaveLength(0)
    })

    it('decrements org quota used after deleting a sized file', async () => {
      const { app, db } = createTestApp()
      const headers = await authedHeaders(app)
      const orgId = await getOrgId(db)
      const now = Math.floor(Date.now() / 1000)
      await insertStorage(db)
      await insertQuota(db, orgId, 1073741824)
      await db.run(sql`UPDATE org_quotas SET used = 500 WHERE org_id = ${orgId}`)
      await db.run(
        sql`INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
            VALUES ('del3', ${orgId}, 'del3-alias', 'sized.jpg', 'image/jpeg', 200, 0, '', 'path/sized.jpg', 's1', 'trashed', ${now}, ${now})`,
      )

      await app.request('/api/objects/del3', { method: 'DELETE', headers })

      const quotaRows = await db.all<{ used: number }>(sql`SELECT used FROM org_quotas WHERE org_id = ${orgId}`)
      expect(quotaRows[0].used).toBe(300)
    })
  })
})
