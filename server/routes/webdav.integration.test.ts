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
  vi.spyOn(S3Service.prototype, 'getObjectBytes').mockResolvedValue(new TextEncoder().encode('hello webdav'))
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

async function teamWorkspace(
  db: TestApp['db'],
  opts: { id: string; slug: string; userId?: string; name?: string },
): Promise<{ id: string; slug: string }> {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
    VALUES (${opts.id}, ${opts.name ?? opts.slug}, ${opts.slug}, '{}', ${now}, ${now})
  `)
  if (opts.userId) {
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${`mem-${opts.id}`}, ${opts.id}, ${opts.userId}, 'member', ${now})
    `)
  }
  return { id: opts.id, slug: opts.slug }
}

async function userAccount(db: TestApp['db']) {
  const rows = await db.all<{ id: string; email: string; username: string | null }>(
    sql`SELECT id, email, username FROM user LIMIT 1`,
  )
  if (!rows[0]) throw new Error('No user found')
  return rows[0]
}

function basicHeaders(username: string, password: string, extra?: Record<string, string>) {
  return { Authorization: `Basic ${btoa(`${username}:${password}`)}`, ...extra }
}

async function apiKey(auth: TestApp['auth'], userId: string, permissions: Record<string, string[]>) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: { configId: 'webdav', userId, permissions },
  })) as { key: string }
  return result.key
}

async function imageHostingApiKey(auth: TestApp['auth'], orgId: string, userId: string) {
  // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
  const result = (await (auth.api as any).createApiKey({
    body: { organizationId: orgId, userId },
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
    const { slug } = await org(db)
    const account = await userAccount(db)
    const readKey = await apiKey(auth, account.id, { webdav: ['read'] })

    const missing = await app.request(`/dav/${slug}/`, { method: 'PROPFIND' })
    expect(missing.status).toBe(401)
    expect(missing.headers.get('WWW-Authenticate')).toBe('Basic realm="ZPan WebDAV"')
    expect((await app.request(`/dav/${slug}/`, { method: 'PROPFIND', headers })).status).toBe(401)
    expect(
      (await app.request(`/dav/${slug}/`, { method: 'PROPFIND', headers: { Authorization: `Bearer ${readKey}` } }))
        .status,
    ).toBe(401)
    expect(
      (
        await app.request(`/dav/${slug}/new.txt`, {
          method: 'PUT',
          headers: basicHeaders(account.email, readKey),
          body: 'content',
        })
      ).status,
    ).toBe(401)
  })

  it('rejects org-bound image-hosting API keys for WebDAV Basic Auth', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await imageHostingApiKey(auth, workspace.id, account.id)

    const res = await app.request(`/dav/${workspace.slug}/`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="ZPan WebDAV"')
  })

  it('PROPFIND lists the mount root, workspace root, and folder children', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await folder(db, workspace.id, { id: 'docs', name: 'Docs' })
    await file(db, workspace.id, { id: 'readme', name: 'readme.txt', parent: 'Docs' })

    const root = await app.request('/dav/', { method: 'PROPFIND', headers: basicHeaders(account.email, key) })
    expect(root.status).toBe(207)
    expect(await root.text()).toContain(`/dav/${workspace.slug}/`)

    const docs = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.username ?? account.email, key),
    })
    expect(docs.status).toBe(207)
    const xml = await docs.text()
    expect(xml).toContain(`/dav/${workspace.slug}/Docs/`)
    expect(xml).toContain(`/dav/${workspace.slug}/Docs/readme.txt`)
    for (const property of [
      'displayname',
      'creationdate',
      'getetag',
      'getcontentlength',
      'getcontenttype',
      'getlastmodified',
      'resourcetype',
      'supportedlock',
      'lockdiscovery',
    ]) {
      expect(xml).toContain(`<D:${property}`)
    }

    const byId = await app.request(`/dav/${workspace.id}/`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(byId.status).toBe(207)
  })

  it('PROPFIND mount root lists all member workspaces and hides non-member workspaces', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const workspace = await org(db)
    const account = await userAccount(db)
    const team = await teamWorkspace(db, { id: 'team-dav', slug: 'team-dav', userId: account.id, name: 'Team DAV' })
    const hidden = await teamWorkspace(db, { id: 'hidden-dav', slug: 'hidden-dav', name: 'Hidden DAV' })
    const key = await apiKey(auth, account.id, { webdav: ['read'] })

    const root = await app.request('/dav/', { method: 'PROPFIND', headers: basicHeaders(account.email, key) })
    expect(root.status).toBe(207)
    const xml = await root.text()
    expect(xml).toContain(`/dav/${workspace.slug}/`)
    expect(xml).toContain(`/dav/${team.slug}/`)
    expect(xml).not.toContain(`/dav/${hidden.slug}/`)

    const hiddenRes = await app.request(`/dav/${hidden.slug}/`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(hiddenRes.status).toBe(404)
  })

  it('PROPFIND supports prop, propname, allprop include, explicit depths, and rejects infinity', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await folder(db, workspace.id, { id: 'docs', name: 'Docs' })
    await file(db, workspace.id, { id: 'readme', name: 'readme.txt', parent: 'Docs' })

    const prop = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: `<?xml version="1.0"?>
        <D:propfind xmlns:D="DAV:">
          <D:prop><D:displayname/><D:quota-used-bytes/></D:prop>
        </D:propfind>`,
    })
    expect(prop.status).toBe(207)
    const propXml = await prop.text()
    expect(propXml).toContain('<D:displayname>Docs</D:displayname>')
    expect(propXml).toContain('HTTP/1.1 404 Not Found')
    expect(propXml).not.toContain('readme.txt')

    const propname = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '1', 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>',
    })
    expect(propname.status).toBe(207)
    const propnameXml = await propname.text()
    expect(propnameXml).toContain('<D:displayname/>')
    expect(propnameXml).toContain(`/dav/${workspace.slug}/Docs/readme.txt`)

    const allprop = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:"><D:allprop/><D:include><D:quota-used-bytes/></D:include></D:propfind>',
    })
    expect(allprop.status).toBe(207)
    expect(await allprop.text()).toContain('HTTP/1.1 404 Not Found')

    const infinity = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: 'infinity' }),
    })
    expect(infinity.status).toBe(403)
    expect(await infinity.text()).toContain('propfind-finite-depth')
  })

  it('PROPPATCH stores and removes dead properties visible to later PROPFIND', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'dead-props', name: 'dead-props.txt' })

    const set = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: `<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:zpan:test">
        <D:set><D:prop><Z:color>blue</Z:color></D:prop></D:set>
      </D:propertyupdate>`,
    })
    expect(set.status).toBe(207)
    expect(await set.text()).toContain('HTTP/1.1 200 OK')

    const find = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:zpan:test"><D:prop><Z:color/></D:prop></D:propfind>',
    })
    expect(find.status).toBe(207)
    expect(await find.text()).toContain('blue</Z:color>')

    const invalid = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:getetag>bad</D:getetag></D:prop></D:set></D:propertyupdate>',
    })
    expect(invalid.status).toBe(403)

    const remove = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:zpan:test"><D:remove><D:prop><Z:color/></D:prop></D:remove></D:propertyupdate>',
    })
    expect(remove.status).toBe(207)

    const removed = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:zpan:test"><D:prop><Z:color/></D:prop></D:propfind>',
    })
    expect(await removed.text()).toContain('HTTP/1.1 404 Not Found')
  })

  it('GET returns file bytes directly and HEAD returns coherent file headers', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'readme', name: 'readme.txt', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/readme.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    expect(head.status).toBe(200)
    expect(head.headers.get('Content-Type')).toBe('text/plain')
    expect(head.headers.get('Content-Length')).toBe('12')
    expect(head.headers.get('ETag')).toMatch(/^"readme-12-\d+"$/)
    expect(head.headers.get('Last-Modified')).toBeTruthy()

    const get = await app.request(`/dav/${workspace.slug}/readme.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key),
    })
    expect(get.status).toBe(200)
    expect(get.headers.get('Content-Type')).toBe('text/plain')
    expect(get.headers.get('Content-Length')).toBe('12')
    expect(get.headers.get('ETag')).toBe(head.headers.get('ETag'))
    expect(get.headers.get('Last-Modified')).toBe(head.headers.get('Last-Modified'))
    expect(get.headers.get('Location')).toBeNull()
    expect(await get.text()).toBe('hello webdav')
    expect(S3Service.prototype.presignDownload).not.toHaveBeenCalled()
    expect(S3Service.prototype.getObjectBytes).toHaveBeenCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/readme.txt',
    )
  })

  it('GET supports valid byte ranges and rejects invalid ranges', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'range', name: 'range.txt', size: 12 })
    vi.mocked(S3Service.prototype.getObjectBytes).mockResolvedValueOnce(new TextEncoder().encode('hello'))

    const partial = await app.request(`/dav/${workspace.slug}/range.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=0-4' }),
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('Content-Range')).toBe('bytes 0-4/12')
    expect(partial.headers.get('Content-Length')).toBe('5')
    expect(await partial.text()).toBe('hello')
    expect(S3Service.prototype.getObjectBytes).toHaveBeenCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/range.txt',
      'bytes=0-4',
    )

    const invalid = await app.request(`/dav/${workspace.slug}/range.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=99-100' }),
    })
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('Content-Range')).toBe('bytes */12')

    vi.mocked(S3Service.prototype.getObjectBytes).mockResolvedValueOnce(new TextEncoder().encode('dav'))
    const suffix = await app.request(`/dav/${workspace.slug}/range.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=-3' }),
    })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('Content-Range')).toBe('bytes 9-11/12')
    expect(await suffix.text()).toBe('dav')
  })

  it('honors ETag preconditions and changes ETag after overwrite', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'precondition', name: 'precondition.txt', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    const etag = head.headers.get('ETag')
    expect(etag).toBeTruthy()

    const matched = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key, { 'If-Match': etag ?? '' }),
    })
    expect(matched.status).toBe(200)

    const notModified = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { 'If-None-Match': etag ?? '' }),
    })
    expect(notModified.status).toBe(304)

    const rejected = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'If-Match': '"stale"', 'Content-Type': 'text/plain' }),
      body: 'new bytes',
    })
    expect(rejected.status).toBe(412)

    const noneMatchRejected = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'If-None-Match': etag ?? '', 'Content-Type': 'text/plain' }),
      body: 'new bytes',
    })
    expect(noneMatchRejected.status).toBe(412)

    const overwrite = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'If-Match': etag ?? '', 'Content-Type': 'text/plain' }),
      body: 'new bytes',
    })
    expect(overwrite.status).toBe(204)

    const updated = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    expect(updated.headers.get('ETag')).not.toBe(etag)
  })

  it('OPTIONS advertises DAV methods', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })

    const res = await app.request('/dav/', { method: 'OPTIONS', headers: basicHeaders(account.email, key) })
    expect(res.status).toBe(204)
    expect(res.headers.get('DAV')).toBe('1, 2')
    expect(res.headers.get('Allow')).toContain('PROPFIND')
    expect(res.headers.get('Allow')).toContain('LOCK')
  })

  it('rejects API keys when verification throws', async () => {
    const { app, auth } = await createTestApp()
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    vi.spyOn(auth.api as any, 'verifyApiKey').mockRejectedValueOnce(new Error('verify failed'))

    const res = await app.request('/dav/', { method: 'PROPFIND', headers: basicHeaders('bad@example.com', 'bad-key') })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="ZPan WebDAV"')
  })

  it('PUT creates a file matter and writes through configured storage', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })

    const res = await app.request(`/dav/${workspace.slug}/upload.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain' }),
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
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'existing', name: 'existing', size: 20 })
    await folder(db, workspace.id, { id: 'docs', name: 'Docs' })

    const update = await app.request(`/dav/${workspace.slug}/existing`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/octet-stream' }),
      body: 'short',
    })
    expect(update.status).toBe(204)
    const rows = await db.all<{ size: number; type: string }>(sql`SELECT size, type FROM matters WHERE id = 'existing'`)
    expect(rows[0]).toEqual({ size: 5, type: 'application/octet-stream' })

    const root = await app.request(`/dav/${workspace.slug}/`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key),
      body: 'nope',
    })
    expect(root.status).toBe(405)

    const folderWrite = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key),
      body: 'nope',
    })
    expect(folderWrite.status).toBe(409)
  })

  it('PUT rolls back quota reservation when storage write fails', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    vi.mocked(S3Service.prototype.putObject).mockRejectedValueOnce(new Error('s3 failed'))

    const res = await app.request(`/dav/${workspace.slug}/will-fail.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain' }),
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
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })

    const res = await app.request(`/dav/${workspace.slug}/Projects`, {
      method: 'MKCOL',
      headers: basicHeaders(account.email, key),
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
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await folder(db, workspace.id, { id: 'projects', name: 'Projects' })
    await file(db, workspace.id, { id: 'file-parent', name: 'file-parent.txt' })

    const existing = await app.request(`/dav/${workspace.slug}/Projects`, {
      method: 'MKCOL',
      headers: basicHeaders(account.email, key),
    })
    expect(existing.status).toBe(405)

    const missingParent = await app.request(`/dav/${workspace.slug}/Missing/Child`, {
      method: 'MKCOL',
      headers: basicHeaders(account.email, key),
    })
    expect(missingParent.status).toBe(409)

    const fileParent = await app.request(`/dav/${workspace.slug}/file-parent.txt/Child`, {
      method: 'MKCOL',
      headers: basicHeaders(account.email, key),
    })
    expect(fileParent.status).toBe(405)
  })

  it('MOVE, COPY, and DELETE stay within org scope; DELETE trashes instead of purging', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const secondWorkspace = await teamWorkspace(db, {
      id: 'second-dav',
      slug: 'second-dav',
      userId: account.id,
      name: 'Second DAV',
    })
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'move-me', name: 'move-me.txt' })

    const move = await app.request(`/dav/${workspace.slug}/move-me.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, { Destination: `http://localhost/dav/${workspace.slug}/moved.txt` }),
    })
    expect(move.status).toBe(201)

    const copy = await app.request(`/dav/${workspace.slug}/moved.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, { Destination: `http://localhost/dav/${workspace.slug}/copied.txt` }),
    })
    expect(copy.status).toBe(201)

    const badMove = await app.request(`/dav/${workspace.slug}/moved.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, { Destination: 'http://localhost/dav/other-workspace/nope.txt' }),
    })
    expect(badMove.status).toBe(404)

    const crossWorkspaceMove = await app.request(`/dav/${workspace.slug}/moved.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${secondWorkspace.slug}/cross-move.txt`,
      }),
    })
    expect(crossWorkspaceMove.status).toBe(403)

    const crossWorkspaceCopy = await app.request(`/dav/${workspace.slug}/moved.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${secondWorkspace.slug}/cross-copy.txt`,
      }),
    })
    expect(crossWorkspaceCopy.status).toBe(403)

    const del = await app.request(`/dav/${workspace.slug}/copied.txt`, {
      method: 'DELETE',
      headers: basicHeaders(account.email, key),
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
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'source', name: 'source.txt' })
    await file(db, workspace.id, { id: 'target', name: 'target.txt' })

    const noDestination = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key),
    })
    expect(noDestination.status).toBe(400)

    const crossOrigin = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `https://example.com/dav/${workspace.slug}/moved.txt`,
      }),
    })
    expect(crossOrigin.status).toBe(400)

    const existing = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/target.txt`,
        Overwrite: 'F',
      }),
    })
    expect(existing.status).toBe(412)
  })

  it('COPY recursively copies collections and rejects copying into own descendant', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await folder(db, workspace.id, { id: 'src-folder', name: 'Source' })
    await folder(db, workspace.id, { id: 'nested-folder', name: 'Nested', parent: 'Source' })
    await file(db, workspace.id, { id: 'nested-file', name: 'note.txt', parent: 'Source/Nested', size: 12 })

    const copied = await app.request(`/dav/${workspace.slug}/Source`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/Copied`,
        Depth: 'infinity',
      }),
    })
    expect(copied.status).toBe(201)
    const rows = await db.all<{ name: string; parent: string }>(
      sql`SELECT name, parent FROM matters WHERE org_id = ${workspace.id} AND status = 'active' AND parent LIKE 'Copied%' ORDER BY parent, name`,
    )
    expect(rows).toContainEqual({ name: 'Nested', parent: 'Copied' })
    expect(rows).toContainEqual({ name: 'note.txt', parent: 'Copied/Nested' })

    const descendant = await app.request(`/dav/${workspace.slug}/Source`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/Source/Child`,
      }),
    })
    expect(descendant.status).toBe(403)
  })

  it('MOVE keeps collection descendant paths consistent and rejects descendant moves', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await folder(db, workspace.id, { id: 'move-folder', name: 'MoveMe' })
    await folder(db, workspace.id, { id: 'move-child', name: 'Child', parent: 'MoveMe' })
    await file(db, workspace.id, { id: 'move-file', name: 'note.txt', parent: 'MoveMe/Child' })

    const moved = await app.request(`/dav/${workspace.slug}/MoveMe`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, { Destination: `http://localhost/dav/${workspace.slug}/Moved` }),
    })
    expect(moved.status).toBe(201)
    const rows = await db.all<{ id: string; parent: string }>(
      sql`SELECT id, parent FROM matters WHERE id IN ('move-child', 'move-file') ORDER BY id`,
    )
    expect(rows).toEqual([
      { id: 'move-child', parent: 'Moved' },
      { id: 'move-file', parent: 'Moved/Child' },
    ])

    const descendant = await app.request(`/dav/${workspace.slug}/Moved`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/Moved/Child/Sub`,
      }),
    })
    expect(descendant.status).toBe(403)
  })

  it('DELETE on collections removes descendants from WebDAV listings', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await folder(db, workspace.id, { id: 'delete-folder', name: 'DeleteMe' })
    await file(db, workspace.id, { id: 'delete-file', name: 'gone.txt', parent: 'DeleteMe' })

    const del = await app.request(`/dav/${workspace.slug}/DeleteMe`, {
      method: 'DELETE',
      headers: basicHeaders(account.email, key),
    })
    expect(del.status).toBe(204)

    const listing = await app.request(`/dav/${workspace.slug}/DeleteMe`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(listing.status).toBe(404)
    const rows = await db.all<{ status: string }>(
      sql`SELECT status FROM matters WHERE id IN ('delete-folder', 'delete-file') ORDER BY id`,
    )
    expect(rows).toEqual([{ status: 'trashed' }, { status: 'trashed' }])
  })

  it('If header evaluates ETag matches, misses, and Not conditions', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'if-file', name: 'if.txt', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    const etag = head.headers.get('ETag') ?? ''

    const matched = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { If: `([${etag}])`, 'Content-Type': 'text/plain' }),
      body: 'matched',
    })
    expect(matched.status).toBe(204)

    const missed = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { If: '(["stale"])', 'Content-Type': 'text/plain' }),
      body: 'missed',
    })
    expect(missed.status).toBe(412)

    const notMatched = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { If: '(Not ["stale"])', 'Content-Type': 'text/plain' }),
      body: 'not matched',
    })
    expect(notMatched.status).toBe(204)
  })

  it('LOCK and UNLOCK expose Class 2 state and enforce write tokens', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'lock-file', name: 'locked.txt', size: 12 })

    const locked = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, {
        Depth: '0',
        Timeout: 'Second-600',
        'Content-Type': 'application/xml',
      }),
      body: '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>tester</D:owner></D:lockinfo>',
    })
    expect(locked.status).toBe(200)
    const token = locked.headers.get('Lock-Token') ?? ''
    expect(token).toMatch(/^<opaquelocktoken:/)
    expect(await locked.text()).toContain('lockdiscovery')

    const discovery = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0' }),
    })
    const discoveryXml = await discovery.text()
    expect(discoveryXml).toContain('supportedlock')
    expect(discoveryXml).toContain(token.slice(1, -1))

    const rejected = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain' }),
      body: 'blocked',
    })
    expect(rejected.status).toBe(423)

    const accepted = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Lock-Token': token, 'Content-Type': 'text/plain' }),
      body: 'allowed',
    })
    expect(accepted.status).toBe(204)

    const refreshed = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, Timeout: 'Second-1200' }),
    })
    expect(refreshed.status).toBe(200)

    const invalidUnlock = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'UNLOCK',
      headers: basicHeaders(account.email, key, { 'Lock-Token': '<opaquelocktoken:bad>' }),
    })
    expect(invalidUnlock.status).toBe(409)

    const unlocked = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'UNLOCK',
      headers: basicHeaders(account.email, key, { 'Lock-Token': token }),
    })
    expect(unlocked.status).toBe(204)

    const afterUnlock = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain' }),
      body: 'after',
    })
    expect(afterUnlock.status).toBe(204)
  })

  it('returns WebDAV path errors for missing GET and DELETE targets', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })

    const missingGet = await app.request(`/dav/${workspace.slug}/missing.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key),
    })
    expect(missingGet.status).toBe(404)

    const missingDelete = await app.request(`/dav/${workspace.slug}/missing.txt`, {
      method: 'DELETE',
      headers: basicHeaders(account.email, key),
    })
    expect(missingDelete.status).toBe(404)
  })

  it('MOVE honors Overwrite header for existing destinations', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'move-source', name: 'move-source.txt' })
    await file(db, workspace.id, { id: 'move-target', name: 'move-target.txt' })

    const blocked = await app.request(`/dav/${workspace.slug}/move-source.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/move-target.txt`,
        Overwrite: 'F',
      }),
    })
    expect(blocked.status).toBe(412)

    const replaced = await app.request(`/dav/${workspace.slug}/move-source.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/move-target.txt`,
      }),
    })
    expect(replaced.status).toBe(201)
    const rows = await db.all<{ id: string; name: string; status: string }>(
      sql`SELECT id, name, status FROM matters WHERE id IN ('move-source', 'move-target') ORDER BY id`,
    )
    expect(rows).toEqual([
      { id: 'move-source', name: 'move-target.txt', status: 'active' },
      { id: 'move-target', name: 'move-target.txt', status: 'trashed' },
    ])
  })

  it('COPY honors Overwrite header for existing destinations and copies collection roots', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'copy-source', name: 'copy-source.txt', size: 12 })
    await file(db, workspace.id, { id: 'copy-target', name: 'copy-target.txt' })
    await folder(db, workspace.id, { id: 'copy-folder', name: 'Copy Folder' })

    const blocked = await app.request(`/dav/${workspace.slug}/copy-source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/copy-target.txt`,
        Overwrite: 'F',
      }),
    })
    expect(blocked.status).toBe(412)

    const replaced = await app.request(`/dav/${workspace.slug}/copy-source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/copy-target.txt`,
      }),
    })
    expect(replaced.status).toBe(201)
    const rows = await db.all<{ status: string }>(sql`SELECT status FROM matters WHERE id = 'copy-target'`)
    expect(rows[0]?.status).toBe('trashed')

    const collection = await app.request(`/dav/${workspace.slug}/Copy%20Folder`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/Copied%20Folder`,
        Depth: '0',
      }),
    })
    expect(collection.status).toBe(201)
    const folders = await db.all<{ name: string; parent: string }>(
      sql`SELECT name, parent FROM matters WHERE org_id = ${workspace.id} AND name = 'Copied Folder'`,
    )
    expect(folders[0]).toEqual({ name: 'Copied Folder', parent: '' })
  })

  it('COPY rolls back quota reservation when storage copy fails', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'source', name: 'source.txt', size: 12 })
    vi.mocked(S3Service.prototype.copyObject).mockRejectedValueOnce(new Error('copy failed'))

    const res = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, { Destination: `http://localhost/dav/${workspace.slug}/copy.txt` }),
    })
    expect(res.status).toBe(500)
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storage.id}`)
    expect(rows[0]?.used).toBe(0)
  })

  it('rejects traversal, empty segments, and encoded path separators', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })

    for (const path of [
      `/dav/${workspace.slug}/%252e%252e/x`,
      `/dav/${workspace.slug}//x`,
      `/dav/${workspace.slug}/a%2Fb`,
      `/dav/${workspace.slug}/%E0%A4%A`,
    ]) {
      const res = await app.request(path, { method: 'PROPFIND', headers: basicHeaders(account.email, key) })
      expect(res.status, path).toBe(400)
    }
  })
})
