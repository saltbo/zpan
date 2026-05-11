import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const storage = {
  id: 'dav-storage',
  title: 'DAV Storage',
  mode: 'private',
  bucket: 'dav-bucket',
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  accessKey: 'key',
  secretKey: 'secret',
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(S3Service.prototype, 'presignDownload').mockResolvedValue('https://download.example.com/file.txt')
  vi.spyOn(S3Service.prototype, 'putObject').mockResolvedValue(undefined)
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

async function seedStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${storage.id}, ${storage.title}, ${storage.mode}, ${storage.bucket}, ${storage.endpoint}, ${storage.region}, ${storage.accessKey}, ${storage.secretKey}, '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function org(db: TestApp['db']) {
  const rows = await db.all<{ id: string; slug: string }>(sql`
    SELECT id, slug FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  if (!rows[0]) throw new Error('No personal org found')
  return rows[0]
}

async function userId(db: TestApp['db']) {
  const rows = await db.all<{ id: string }>(sql`SELECT id FROM user LIMIT 1`)
  if (!rows[0]) throw new Error('No user found')
  return rows[0].id
}

async function apiKey(auth: TestApp['auth'], orgId: string, userId: string, permissions: Record<string, string[]>) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: { organizationId: orgId, userId, permissions },
  })) as { key: string }
  return result.key
}

async function file(
  db: TestApp['db'],
  orgId: string,
  opts: { id: string; name: string; parent?: string; size?: number },
) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'text/plain', ${opts.size ?? 5}, 0, ${opts.parent ?? ''}, ${`objects/${opts.id}.txt`}, ${storage.id}, 'active', ${now}, ${now})
  `)
}

async function folder(db: TestApp['db'], orgId: string, opts: { id: string; name: string; parent?: string }) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
    VALUES (${opts.id}, ${orgId}, ${`${opts.id}-alias`}, ${opts.name}, 'folder', 0, 1, ${opts.parent ?? ''}, '', ${storage.id}, 'active', ${now}, ${now})
  `)
}

describe('WebDAV API', () => {
  it('rejects missing and insufficient API keys without accepting session cookies', async () => {
    const { app, db, auth } = await createTestApp()
    const headers = await authedHeaders(app)
    const { id, slug } = await org(db)
    const readKey = await apiKey(auth, id, await userId(db), { webdav: ['read'] })

    expect((await app.request(`/dav/${slug}/`, { method: 'PROPFIND' })).status).toBe(401)
    expect((await app.request(`/dav/${slug}/`, { method: 'PROPFIND', headers })).status).toBe(401)
    expect(
      (
        await app.request(`/dav/${slug}/new.txt`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${readKey}` },
          body: 'content',
        })
      ).status,
    ).toBe(401)
  })

  it('PROPFIND lists the mount root, workspace root, and folder children', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['read'] })
    await folder(db, workspace.id, { id: 'docs', name: 'Docs' })
    await file(db, workspace.id, { id: 'readme', name: 'readme.txt', parent: 'Docs' })

    const root = await app.request('/dav/', { method: 'PROPFIND', headers: { Authorization: `Bearer ${key}` } })
    expect(root.status).toBe(207)
    expect(await root.text()).toContain(`/dav/${workspace.slug}/`)

    const docs = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(docs.status).toBe(207)
    const xml = await docs.text()
    expect(xml).toContain(`/dav/${workspace.slug}/Docs/`)
    expect(xml).toContain(`/dav/${workspace.slug}/Docs/readme.txt`)
  })

  it('GET redirects to storage and HEAD returns file headers', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['read'] })
    await file(db, workspace.id, { id: 'readme', name: 'readme.txt', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/readme.txt`, {
      method: 'HEAD',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Type')).toBe('text/plain')
    expect(head.headers.get('Content-Length')).toBe('12')

    const get = await app.request(`/dav/${workspace.slug}/readme.txt`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(get.status).toBe(302)
    expect(get.headers.get('Location')).toBe('https://download.example.com/file.txt')
  })

  it('OPTIONS advertises DAV methods', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['read'] })

    const res = await app.request('/dav/', { method: 'OPTIONS', headers: { Authorization: `Bearer ${key}` } })
    expect(res.status).toBe(204)
    expect(res.headers.get('DAV')).toBe('1')
    expect(res.headers.get('Allow')).toContain('PROPFIND')
  })

  it('rejects API keys when verification throws', async () => {
    const { app, auth } = await createTestApp()
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    vi.spyOn(auth.api as any, 'verifyApiKey').mockRejectedValueOnce(new Error('verify failed'))

    const res = await app.request('/dav/', { method: 'PROPFIND', headers: { Authorization: 'Bearer bad-key' } })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Invalid API key')
  })

  it('PUT creates a file matter and writes through configured storage', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })

    const res = await app.request(`/dav/${workspace.slug}/upload.txt`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
      body: 'hello dav',
    })
    expect(res.status).toBe(201)
    expect(S3Service.prototype.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: storage.id }),
      expect.any(String),
      expect.any(Uint8Array),
      'text/plain',
    )

    const rows = await db.all<{ name: string; size: number; status: string }>(
      sql`SELECT name, size, status FROM matters WHERE org_id = ${workspace.id} AND name = 'upload.txt'`,
    )
    expect(rows[0]).toEqual({ name: 'upload.txt', size: 9, status: 'active' })
  })

  it('PUT updates an existing file matter and rejects collection writes', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })
    await file(db, workspace.id, { id: 'existing', name: 'existing', size: 20 })
    await folder(db, workspace.id, { id: 'docs', name: 'Docs' })

    const update = await app.request(`/dav/${workspace.slug}/existing`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/octet-stream' },
      body: 'short',
    })
    expect(update.status).toBe(204)
    const rows = await db.all<{ size: number; type: string }>(sql`SELECT size, type FROM matters WHERE id = 'existing'`)
    expect(rows[0]).toEqual({ size: 5, type: 'application/octet-stream' })

    const root = await app.request(`/dav/${workspace.slug}/`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}` },
      body: 'nope',
    })
    expect(root.status).toBe(405)

    const folderWrite = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}` },
      body: 'nope',
    })
    expect(folderWrite.status).toBe(409)
  })

  it('PUT rolls back quota reservation when storage write fails', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })
    vi.mocked(S3Service.prototype.putObject).mockRejectedValueOnce(new Error('s3 failed'))

    const res = await app.request(`/dav/${workspace.slug}/will-fail.txt`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'text/plain' },
      body: 'bytes',
    })
    expect(res.status).toBe(500)
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storage.id}`)
    expect(rows[0]?.used).toBe(0)
  })

  it('MKCOL creates a folder matter', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })

    const res = await app.request(`/dav/${workspace.slug}/Projects`, {
      method: 'MKCOL',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(201)
    const rows = await db.all<{ dirtype: number }>(
      sql`SELECT dirtype FROM matters WHERE org_id = ${workspace.id} AND name = 'Projects'`,
    )
    expect(rows[0]?.dirtype).toBe(1)
  })

  it('MKCOL rejects existing targets and missing parent collections', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })
    await folder(db, workspace.id, { id: 'projects', name: 'Projects' })
    await file(db, workspace.id, { id: 'file-parent', name: 'file-parent.txt' })

    const existing = await app.request(`/dav/${workspace.slug}/Projects`, {
      method: 'MKCOL',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(existing.status).toBe(405)

    const missingParent = await app.request(`/dav/${workspace.slug}/Missing/Child`, {
      method: 'MKCOL',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(missingParent.status).toBe(409)

    const fileParent = await app.request(`/dav/${workspace.slug}/file-parent.txt/Child`, {
      method: 'MKCOL',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(fileParent.status).toBe(405)
  })

  it('MOVE, COPY, and DELETE stay within org scope; DELETE trashes instead of purging', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })
    await file(db, workspace.id, { id: 'move-me', name: 'move-me.txt' })

    const move = await app.request(`/dav/${workspace.slug}/move-me.txt`, {
      method: 'MOVE',
      headers: { Authorization: `Bearer ${key}`, Destination: `http://localhost/dav/${workspace.slug}/moved.txt` },
    })
    expect(move.status).toBe(201)

    const copy = await app.request(`/dav/${workspace.slug}/moved.txt`, {
      method: 'COPY',
      headers: { Authorization: `Bearer ${key}`, Destination: `http://localhost/dav/${workspace.slug}/copied.txt` },
    })
    expect(copy.status).toBe(201)

    const badMove = await app.request(`/dav/${workspace.slug}/moved.txt`, {
      method: 'MOVE',
      headers: { Authorization: `Bearer ${key}`, Destination: 'http://localhost/dav/other-workspace/nope.txt' },
    })
    expect(badMove.status).toBe(404)

    const del = await app.request(`/dav/${workspace.slug}/copied.txt`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(del.status).toBe(204)
    const rows = await db.all<{ status: string }>(
      sql`SELECT status FROM matters WHERE org_id = ${workspace.id} AND name = 'copied.txt'`,
    )
    expect(rows[0]?.status).toBe('trashed')
  })

  it('MOVE and COPY reject invalid destinations', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })
    await file(db, workspace.id, { id: 'source', name: 'source.txt' })
    await file(db, workspace.id, { id: 'target', name: 'target.txt' })

    const noDestination = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'MOVE',
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(noDestination.status).toBe(400)

    const crossOrigin = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'MOVE',
      headers: { Authorization: `Bearer ${key}`, Destination: `https://example.com/dav/${workspace.slug}/moved.txt` },
    })
    expect(crossOrigin.status).toBe(400)

    const existing = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'COPY',
      headers: { Authorization: `Bearer ${key}`, Destination: `http://localhost/dav/${workspace.slug}/target.txt` },
    })
    expect(existing.status).toBe(412)
  })

  it('COPY rolls back quota reservation when storage copy fails', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['write'] })
    await file(db, workspace.id, { id: 'source', name: 'source.txt', size: 12 })
    vi.mocked(S3Service.prototype.copyObject).mockRejectedValueOnce(new Error('copy failed'))

    const res = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'COPY',
      headers: { Authorization: `Bearer ${key}`, Destination: `http://localhost/dav/${workspace.slug}/copy.txt` },
    })
    expect(res.status).toBe(500)
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storage.id}`)
    expect(rows[0]?.used).toBe(0)
  })

  it('rejects traversal, empty segments, and encoded path separators', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const workspace = await org(db)
    const key = await apiKey(auth, workspace.id, await userId(db), { webdav: ['read'] })

    for (const path of [
      `/dav/${workspace.slug}/%252e%252e/x`,
      `/dav/${workspace.slug}//x`,
      `/dav/${workspace.slug}/a%2Fb`,
      `/dav/${workspace.slug}/%E0%A4%A`,
    ]) {
      const res = await app.request(path, { method: 'PROPFIND', headers: { Authorization: `Bearer ${key}` } })
      expect(res.status, path).toBe(400)
    }
  })
})
