import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import { Readable } from 'node:stream'
import { serve } from '@hono/node-server'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from 'webdav'
import { S3Service } from '../adapters/gateways/s3.js'
import { storages } from '../db/schema.js'
import { currentTrafficPeriod } from '../domain/quota.js'
import { encodeDavPathSegment } from '../domain/webdav.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const storage = {
  id: 'dav-storage',
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
  vi.spyOn(S3Service.prototype, 'getObjectBody').mockImplementation(async () => streamBody('hello webdav'))
  vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(
    async (_storage, _key, body, _contentType, contentLength) =>
      contentLength ??
      (body instanceof Uint8Array ? body.byteLength : (await new Response(body).arrayBuffer()).byteLength),
  )
  vi.spyOn(S3Service.prototype, 'copyObject').mockResolvedValue(undefined)
})

function streamBody(text: string): ReadableStream {
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function seedStorage(db: TestApp['db']) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES (${storage.id}, ${storage.bucket}, ${storage.endpoint}, ${storage.region}, ${storage.accessKey}, ${storage.secretKey}, '', '', 0, 0, 'active', ${now}, ${now})
  `)
}

async function seedTrafficPlan(db: TestApp['db'], orgId: string, bytes: number, used = 0) {
  const now = Date.now()
  await db.run(sql`
    UPDATE org_quotas
    SET traffic_used = ${used}, traffic_period = ${currentTrafficPeriod()}
    WHERE org_id = ${orgId}
  `)
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
      (${`traffic-plan-${orgId}-${now}`}, ${orgId}, 'traffic', 'plan', 'test', ${`traffic-plan:${orgId}:${now}`}, ${bytes}, ${now}, NULL, 'active', '{"packageName":"Traffic Plan"}', ${now}, ${now})
  `)
}

async function org(db: TestApp['db']) {
  const rows = await db.all<{ id: string; name: string; slug: string }>(sql`
    SELECT id, name, slug FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1
  `)
  if (!rows[0]) throw new Error('No personal org found')
  return rows[0]
}

async function teamWorkspace(
  db: TestApp['db'],
  opts: { id: string; slug: string; userId?: string; name?: string },
): Promise<{ id: string; name: string; slug: string }> {
  const now = Date.now()
  const name = opts.name ?? opts.slug
  await db.run(sql`
    INSERT INTO organization (id, name, slug, metadata, created_at, updated_at)
    VALUES (${opts.id}, ${name}, ${opts.slug}, '{}', ${now}, ${now})
  `)
  if (opts.userId) {
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      VALUES (${`mem-${opts.id}`}, ${opts.id}, ${opts.userId}, 'member', ${now})
    `)
  }
  return { id: opts.id, name, slug: opts.slug }
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

function escapedDavHref(name: string, path = '') {
  return `/dav/${encodeDavPathSegment(name)}/${path}`
}

function davPathForName(name: string, path = '') {
  return `/dav/${encodeDavPathSegment(name)}/${path}`
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
    body: { configId: 'ihost', organizationId: orgId, userId },
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
  it('rejects missing and insufficient API keys without accepting session cookies [spec: webdav/auth]', async () => {
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

  it('rejects org-bound image-hosting API keys for WebDAV Basic Auth [spec: webdav/auth-key-scope]', async () => {
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

  it('PROPFIND lists the mount root, workspace root, and folder children [spec: webdav/propfind]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await folder(db, workspace.id, { id: 'docs', name: 'Docs' })
    await file(db, workspace.id, { id: 'readme', name: 'readme.txt', parent: 'Docs' })
    await file(db, workspace.id, { id: 'special', name: 'Miss Americana & The Heartbreak Prince.txt', parent: 'Docs' })

    const root = await app.request('/dav/', { method: 'PROPFIND', headers: basicHeaders(account.email, key) })
    expect(root.status).toBe(207)
    const rootXml = await root.text()
    expect(rootXml).toContain(escapedDavHref(workspace.name))
    expect(rootXml).not.toContain(`/dav/${encodeURIComponent(workspace.name).replaceAll("'", '&apos;')}/`)

    const rootWithoutSlash = await app.request('/dav', {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(rootWithoutSlash.status).toBe(207)
    expect(await rootWithoutSlash.text()).toContain(escapedDavHref(workspace.name))

    const docs = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.username ?? account.email, key),
    })
    expect(docs.status).toBe(207)
    const xml = await docs.text()
    expect(xml).toContain(escapedDavHref(workspace.name, 'Docs/'))
    expect(xml).toContain(escapedDavHref(workspace.name, 'Docs/readme.txt'))
    expect(xml).toContain(escapedDavHref(workspace.name, 'Docs/Miss%20Americana%20%26%20The%20Heartbreak%20Prince.txt'))
    expect(xml).toContain('<D:displayname>Miss Americana &amp; The Heartbreak Prince.txt</D:displayname>')

    const doubledMountSlash = await app.request(`/dav//${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(doubledMountSlash.status).toBe(207)

    const docsByDisplayName = await app.request(davPathForName(workspace.name, 'Docs'), {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(docsByDisplayName.status).toBe(207)
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

  it('uses root-relative hrefs and destinations on the configured DAV hostname [spec: webdav/custom-host]', async () => {
    const { app, db, auth } = await createTestApp({ WEBDAV_PUBLIC_URL: 'https://dav.example.com' })
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'custom-host-source', name: 'source.txt', size: 12 })

    const root = await app.request('https://dav.example.com/dav/', {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    const rootXml = await root.text()
    const workspacePath = encodeDavPathSegment(workspace.name)
    expect(root.status).toBe(207)
    expect(rootXml).toContain('<D:href>/</D:href>')
    expect(rootXml).toContain(`<D:href>/${workspacePath}/</D:href>`)
    expect(rootXml).not.toContain('/dav/')

    const patch = await app.request(`https://dav.example.com/dav/${workspace.slug}/source.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:zpan:test"><D:set><D:prop><Z:color>blue</Z:color></D:prop></D:set></D:propertyupdate>',
    })
    expect(await patch.text()).toContain(`<D:href>/${workspacePath}/source.txt</D:href>`)

    // Simulate TLS termination: the proxy-facing request URL is http while the
    // public Destination remains https on the same configured hostname.
    const copy = await app.request(`http://dav.example.com/dav/${workspace.slug}/source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `https://dav.example.com/${workspacePath}/copied.txt`,
      }),
    })
    expect(copy.status).toBe(201)
    expect(copy.headers.get('Location')).toBe(`https://dav.example.com/${workspacePath}/copied.txt`)

    const mainOrigin = await app.request(`https://pan.example.com/dav/${workspace.slug}/source.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0' }),
    })
    expect(await mainOrigin.text()).toContain(`<D:href>/dav/${workspacePath}/source.txt</D:href>`)
  })

  it('does not adopt the DAV hostname as the site public origin', async () => {
    const { app, db } = await createTestApp({ WEBDAV_PUBLIC_URL: 'https://dav.example.com' })

    const res = await app.request('https://dav.example.com/dav/', { method: 'PROPFIND' })
    expect(res.status).toBe(401)
    const rows = await db.all<{ value: string }>(sql`SELECT value FROM system_options WHERE key = 'site_public_origin'`)
    expect(rows).toEqual([])
  })

  it('PROPFIND mount root lists all member workspaces and hides non-member workspaces [spec: webdav/propfind-workspaces]', async () => {
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
    expect(xml).toContain(escapedDavHref(workspace.name))
    expect(xml).toContain(escapedDavHref(team.name))
    expect(xml).not.toContain(`/dav/${hidden.slug}/`)

    const hiddenRes = await app.request(`/dav/${hidden.slug}/`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key),
    })
    expect(hiddenRes.status).toBe(404)
  })

  it('PROPFIND supports prop, propname, allprop include, explicit depths, and rejects infinity [spec: webdav/propfind-modes]', async () => {
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
    expect(propnameXml).toContain(escapedDavHref(workspace.name, 'Docs/readme.txt'))

    const defaultNamespace = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: `<?xml version="1.0"?>
        <propfind xmlns="DAV:">
          <!-- default namespace property names are valid RFC 4918 XML -->
          <prop><displayname/></prop>
        </propfind>`,
    })
    expect(defaultNamespace.status).toBe(207)
    expect(await defaultNamespace.text()).toContain('<D:displayname>Docs</D:displayname>')

    const allprop = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:"><D:allprop/><D:include><D:displayname/><D:quota-used-bytes/></D:include></D:propfind>',
    })
    expect(allprop.status).toBe(207)
    expect(await allprop.text()).toContain('HTTP/1.1 404 Not Found')

    const invalidRequestType = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<propfind xmlns="DAV:"><prop/><allprop/></propfind>',
    })
    expect(invalidRequestType.status).toBe(400)

    const infinity = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: 'infinity' }),
    })
    expect(infinity.status).toBe(403)
    expect(await infinity.text()).toContain('propfind-finite-depth')
  })

  it('PROPPATCH stores and removes dead properties visible to later PROPFIND [spec: webdav/proppatch]', async () => {
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

    const defaultDeadPropertyNamespace = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: `<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:zpan:test">
        <D:set><D:prop><Z:finish xmlns:Z="urn:zpan:test">matte</Z:finish></D:prop></D:set>
        <D:set><D:prop><color xmlns="urn:zpan:test">red</color></D:prop></D:set>
        <D:set><D:prop xmlns="urn:zpan:test"><pattern>striped</pattern></D:prop></D:set>
      </D:propertyupdate>`,
    })
    expect(defaultDeadPropertyNamespace.status).toBe(207)

    const defaultDeadPropertyFind = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:" xmlns="urn:zpan:test" xmlns:Z="urn:zpan:test"><D:prop><Z:finish/><color/><pattern/></D:prop></D:propfind>',
    })
    const defaultDeadPropertyXml = await defaultDeadPropertyFind.text()
    expect(defaultDeadPropertyXml).toContain('<Z:finish xmlns:Z="urn:zpan:test">matte</Z:finish>')
    expect(defaultDeadPropertyXml).toContain('<color xmlns="urn:zpan:test">red</color>')
    expect(defaultDeadPropertyXml).toContain('<pattern xmlns="urn:zpan:test">striped</pattern>')

    const invalid = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:getetag>bad</D:getetag></D:prop></D:set></D:propertyupdate>',
    })
    expect(invalid.status).toBe(403)

    const badInstruction = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:"><D:bad/></D:propertyupdate>',
    })
    expect(badInstruction.status).toBe(403)

    const missingProp = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:"><D:set/></D:propertyupdate>',
    })
    expect(missingProp.status).toBe(403)

    const atomicFailure = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: `<propertyupdate xmlns="DAV:" xmlns:Z="urn:zpan:test">
        <set><prop><Z:shape>circle</Z:shape></prop></set>
        <set><prop><getetag>bad</getetag></prop></set>
      </propertyupdate>`,
    })
    expect(atomicFailure.status).toBe(403)

    const afterAtomicFailure = await app.request(`/dav/${workspace.slug}/dead-props.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<propfind xmlns="DAV:" xmlns:Z="urn:zpan:test"><prop><Z:shape/></prop></propfind>',
    })
    expect(await afterAtomicFailure.text()).toContain('HTTP/1.1 404 Not Found')

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

    const rootSet = await app.request(`/dav/${workspace.slug}/`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:zpan:test"><D:set><D:prop><Z:root>yes</Z:root></D:prop></D:set></D:propertyupdate>',
    })
    expect(rootSet.status).toBe(207)

    const rootFind = await app.request(`/dav/${workspace.slug}/`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:zpan:test"><D:prop><Z:root/></D:prop></D:propfind>',
    })
    expect(await rootFind.text()).toContain('yes</Z:root>')
  })

  it('GET returns file bytes directly and HEAD returns coherent file headers [spec: webdav/get]', async () => {
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
    expect(S3Service.prototype.getObjectBody).toHaveBeenCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/readme.txt',
    )
    expect(S3Service.prototype.getObjectBytes).not.toHaveBeenCalled()
    const events = await db.all<{ metadata: string }>(sql`
      SELECT metadata FROM activity_events
      WHERE action = 'webdav_download' AND target_id = 'readme'
    `)
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0].metadata)).toMatchObject({
      bytes: 12,
      source: 'webdav_download',
      status: 'issued',
      matterId: 'readme',
    })
  })

  it('GET consumes WebDAV traffic while HEAD does not [spec: webdav/get-traffic]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'traffic-full', name: 'traffic.txt', size: 12 })
    await seedTrafficPlan(db, workspace.id, 1000, 25)

    const head = await app.request(`/dav/${workspace.slug}/traffic.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    expect(head.status).toBe(200)
    const afterHead = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${workspace.id}`,
    )
    expect(afterHead[0].trafficUsed).toBe(25)

    const get = await app.request(`/dav/${workspace.slug}/traffic.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key),
    })
    expect(get.status).toBe(200)
    await expect(get.text()).resolves.toBe('hello webdav')

    const rows = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${workspace.id}`,
    )
    expect(rows[0].trafficUsed).toBe(37)
  })

  it('GET consumes only served WebDAV range bytes and rejects over-quota reads before S3 access', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'traffic-range', name: 'range-traffic.txt', size: 12 })
    await seedTrafficPlan(db, workspace.id, 30, 25)
    vi.mocked(S3Service.prototype.getObjectBody).mockResolvedValueOnce(streamBody('hello'))

    const partial = await app.request(`/dav/${workspace.slug}/range-traffic.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=0-4' }),
    })
    expect(partial.status).toBe(206)
    await expect(partial.text()).resolves.toBe('hello')

    const afterPartial = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${workspace.id}`,
    )
    expect(afterPartial[0].trafficUsed).toBe(30)

    const over = await app.request(`/dav/${workspace.slug}/range-traffic.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=5-6' }),
    })
    expect(over.status).toBe(422)
    await expect(over.text()).resolves.toBe('Traffic quota exceeded')
    expect(S3Service.prototype.getObjectBody).toHaveBeenCalledTimes(1)

    const invalid = await app.request(`/dav/${workspace.slug}/range-traffic.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=99-100' }),
    })
    expect(invalid.status).toBe(416)
    const afterInvalid = await db.all<{ trafficUsed: number }>(
      sql`SELECT traffic_used AS trafficUsed FROM org_quotas WHERE org_id = ${workspace.id}`,
    )
    expect(afterInvalid[0].trafficUsed).toBe(30)
  })

  it('GET reports metered WebDAV traffic for cloud billing', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    await db.run(sql`
      UPDATE storages
      SET egress_credit_billing_enabled = 1, egress_credit_unit_bytes = 100, egress_credit_per_unit = 2
      WHERE id = ${storage.id}
    `)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'traffic-report', name: 'report.txt', size: 12 })
    await seedTrafficPlan(db, workspace.id, 1000, 0)

    const res = await app.request(`/dav/${workspace.slug}/report.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key),
    })
    expect(res.status).toBe(200)
    await res.text()

    const reports = await db.all<{ source: string; sourceId: string; bytes: number; status: string }>(sql`
      SELECT source, source_id AS sourceId, bytes, status
      FROM cloud_traffic_reports
      WHERE org_id = ${workspace.id}
    `)
    expect(reports).toEqual([])
  })

  it('GET supports valid byte ranges and rejects invalid ranges [spec: webdav/get-range]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'range', name: 'range.txt', size: 12 })
    vi.mocked(S3Service.prototype.getObjectBody).mockResolvedValueOnce(streamBody('hello'))

    const partial = await app.request(`/dav/${workspace.slug}/range.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=0-4' }),
    })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('Content-Range')).toBe('bytes 0-4/12')
    expect(partial.headers.get('Content-Length')).toBe('5')
    expect(await partial.text()).toBe('hello')
    expect(S3Service.prototype.getObjectBody).toHaveBeenCalledWith(
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

    vi.mocked(S3Service.prototype.getObjectBody).mockResolvedValueOnce(streamBody('dav'))
    const suffix = await app.request(`/dav/${workspace.slug}/range.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=-3' }),
    })
    expect(suffix.status).toBe(206)
    expect(suffix.headers.get('Content-Range')).toBe('bytes 9-11/12')
    expect(await suffix.text()).toBe('dav')
    expect(S3Service.prototype.getObjectBytes).not.toHaveBeenCalled()
  })

  it('serves WebDAVFS ranges exactly for mounted media reads', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'mounted-media', name: 'audio.mp3', size: 2 * 1024 * 1024 })
    vi.mocked(S3Service.prototype.getObjectBody).mockResolvedValueOnce(streamBody('chunk'))

    const partial = await app.request(`/dav/${workspace.slug}/audio.mp3`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, {
        Range: 'bytes=419430-419430',
        'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.6.0 (arm64)',
      }),
    })

    expect(partial.status).toBe(206)
    expect(partial.headers.get('Content-Range')).toBe('bytes 419430-419430/2097152')
    expect(partial.headers.get('Content-Length')).toBe('1')
    expect(partial.headers.get('Cache-Control')).toBe('no-store')
    expect(partial.headers.get('ETag')).toBeNull()
    expect(S3Service.prototype.getObjectBody).toHaveBeenCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/mounted-media.txt',
      'bytes=419430-419430',
    )
  })

  it('GET supports multi-range requests and honors If-Range validators', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'if-range', name: 'video.mp4', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/video.mp4`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    const etag = head.headers.get('ETag') ?? ''

    vi.mocked(S3Service.prototype.getObjectBody).mockResolvedValueOnce(streamBody('hello'))
    const matched = await app.request(`/dav/${workspace.slug}/video.mp4`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=0-4', 'If-Range': etag }),
    })
    expect(matched.status).toBe(206)
    expect(matched.headers.get('Content-Range')).toBe('bytes 0-4/12')
    expect(await matched.text()).toBe('hello')
    expect(S3Service.prototype.getObjectBody).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/if-range.txt',
      'bytes=0-4',
    )

    const stale = await app.request(`/dav/${workspace.slug}/video.mp4`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=0-4', 'If-Range': '"stale"' }),
    })
    expect(stale.status).toBe(200)
    expect(stale.headers.get('Content-Range')).toBeNull()
    expect(await stale.text()).toBe('hello webdav')
    expect(S3Service.prototype.getObjectBody).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/if-range.txt',
    )

    vi.mocked(S3Service.prototype.getObjectBody)
      .mockResolvedValueOnce(streamBody('he'))
      .mockResolvedValueOnce(streamBody('o '))
    const multi = await app.request(`/dav/${workspace.slug}/video.mp4`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'bytes=0-1,4-5' }),
    })
    expect(multi.status).toBe(206)
    expect(multi.headers.get('Content-Range')).toBeNull()
    expect(multi.headers.get('Content-Type')).toBe('multipart/byteranges; boundary=zpan-webdav-if-range')
    expect(multi.headers.get('Content-Length')).toBeTruthy()
    expect(await multi.text()).toBe(
      '--zpan-webdav-if-range\r\nContent-Type: text/plain\r\nContent-Range: bytes 0-1/12\r\n\r\nhe\r\n' +
        '--zpan-webdav-if-range\r\nContent-Type: text/plain\r\nContent-Range: bytes 4-5/12\r\n\r\no \r\n' +
        '--zpan-webdav-if-range--\r\n',
    )
    expect(S3Service.prototype.getObjectBody).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/if-range.txt',
      'bytes=4-5',
    )

    const unknownUnit = await app.request(`/dav/${workspace.slug}/video.mp4`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { Range: 'items=0-1' }),
    })
    expect(unknownUnit.status).toBe(200)
    expect(unknownUnit.headers.get('Content-Range')).toBeNull()
  })

  it('honors ETag preconditions and changes ETag after overwrite [spec: webdav/etag-preconditions]', async () => {
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
      headers: basicHeaders(account.email, key, {
        'If-Match': etag ?? '',
        'Content-Type': 'text/plain',
        'Content-Length': '9',
      }),
      body: 'new bytes',
    })
    expect(overwrite.status).toBe(204)

    const updated = await app.request(`/dav/${workspace.slug}/precondition.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    expect(updated.headers.get('ETag')).not.toBe(etag)
  })

  it('does not return 304 for WebDAVFS media reads', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read'] })
    await file(db, workspace.id, { id: 'webdavfs-cache', name: 'cached.mp3', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/cached.mp3`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    const etag = head.headers.get('ETag') ?? ''

    const cached = await app.request(`/dav/${workspace.slug}/cached.mp3`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, {
        'If-None-Match': etag,
        'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.6.0 (arm64)',
      }),
    })

    expect(cached.status).toBe(200)
    expect(await cached.text()).toBe('hello webdav')
    expect(S3Service.prototype.getObjectBody).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: storage.id }),
      'objects/webdavfs-cache.txt',
    )
  })

  it('honors HTTP date preconditions', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'date-precondition', name: 'date.txt', size: 12 })

    const head = await app.request(`/dav/${workspace.slug}/date.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    const lastModified = head.headers.get('Last-Modified') ?? ''
    const stale = new Date(Date.parse(lastModified) - 1000).toUTCString()
    const fresh = new Date(Date.parse(lastModified) + 1000).toUTCString()

    const notModified = await app.request(`/dav/${workspace.slug}/date.txt`, {
      method: 'GET',
      headers: basicHeaders(account.email, key, { 'If-Modified-Since': fresh }),
    })
    expect(notModified.status).toBe(304)

    const staleWrite = await app.request(`/dav/${workspace.slug}/date.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        'If-Unmodified-Since': stale,
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      }),
      body: 'changed',
    })
    expect(staleWrite.status).toBe(412)

    const freshWrite = await app.request(`/dav/${workspace.slug}/date.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        'If-Unmodified-Since': fresh,
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      }),
      body: 'changed',
    })
    expect(freshWrite.status).toBe(204)
  })

  it('OPTIONS advertises DAV methods [spec: webdav/options]', async () => {
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

  it('PUT creates a file matter and writes through configured storage [spec: webdav/put-create]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })

    const res = await app.request(`/dav/${workspace.slug}/upload.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain', 'Content-Length': '9' }),
      body: 'hello dav',
    })
    expect(res.status).toBe(201)
    expect(S3Service.prototype.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ id: storage.id }),
      expect.any(String),
      expect.any(ReadableStream),
      'text/plain',
      9,
    )
    expect(S3Service.prototype.putObject).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(Uint8Array),
      expect.anything(),
      expect.anything(),
    )

    const rows = await db.all<{ name: string; size: number; status: string }>(
      sql`SELECT name, size, status FROM matters WHERE org_id = ${workspace.id} AND name = 'upload.txt'`,
    )
    expect(rows[0]).toEqual({ name: 'upload.txt', size: 9, status: 'active' })
  })

  it('PUT accepts requests without Content-Length and stores the measured size', async () => {
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
      expect.anything(),
      expect.any(String),
      expect.any(ReadableStream),
      'text/plain',
      undefined,
    )
    const rows = await db.all<{ name: string; size: number }>(
      sql`SELECT name, size FROM matters WHERE org_id = ${workspace.id} AND name = 'upload.txt'`,
    )
    expect(rows[0]).toEqual({ name: 'upload.txt', size: 9 })
  })

  it('PUT updates an existing file matter and rejects collection writes [spec: webdav/put-update]', async () => {
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
      headers: basicHeaders(account.email, key, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': '5',
      }),
      body: 'short',
    })
    expect(update.status).toBe(204)
    const rows = await db.all<{ size: number; type: string }>(sql`SELECT size, type FROM matters WHERE id = 'existing'`)
    expect(rows[0]).toEqual({ size: 5, type: 'application/octet-stream' })

    const root = await app.request(`/dav/${workspace.slug}/`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Length': '4' }),
      body: 'nope',
    })
    expect(root.status).toBe(405)

    const folderWrite = await app.request(`/dav/${workspace.slug}/Docs`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Length': '4' }),
      body: 'nope',
    })
    expect(folderWrite.status).toBe(409)
  })

  it('PUT rolls back quota reservation when storage write fails [spec: webdav/put-rollback]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    vi.mocked(S3Service.prototype.putObject).mockRejectedValueOnce(new Error('s3 failed'))

    const res = await app.request(`/dav/${workspace.slug}/will-fail.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain', 'Content-Length': '5' }),
      body: 'bytes',
    })
    expect(res.status).toBe(500)
    const rows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storage.id}`)
    expect(rows[0]?.used).toBe(0)
  })

  it('MKCOL creates a folder matter [spec: webdav/mkcol]', async () => {
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

  it('MKCOL rejects existing targets and missing parent collections [spec: webdav/mkcol-guards]', async () => {
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

    const unsupportedBody = await app.request(`/dav/${workspace.slug}/BodyCollection`, {
      method: 'MKCOL',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<D:mkcol xmlns:D="DAV:"/>',
    })
    expect(unsupportedBody.status).toBe(415)
  })

  it('MOVE, COPY, and DELETE stay within org scope; DELETE trashes instead of purging [spec: webdav/org-scope]', async () => {
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
    const rows = await db.all<{ trashed_at: number | null }>(
      sql`SELECT trashed_at FROM matters WHERE org_id = ${workspace.id} AND name = 'copied.txt'`,
    )
    // Soft delete: the row stays active with trashedAt set.
    expect(rows[0]?.trashed_at).not.toBeNull()
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

    const root = await app.request(`/dav/${workspace.slug}/source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, { Destination: `http://localhost/dav/${workspace.slug}/` }),
    })
    expect(root.status).toBe(405)
  })

  it('COPY recursively copies collections and rejects copying into own descendant [spec: webdav/copy-recursive]', async () => {
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

    const badDepth = await app.request(`/dav/${workspace.slug}/Source`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/BadDepth`,
        Depth: '1',
      }),
    })
    expect(badDepth.status).toBe(400)

    await folder(db, workspace.id, { id: 'existing-copy-root', name: 'ExistingCopy' })
    const replacedCollection = await app.request(`/dav/${workspace.slug}/Source`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/ExistingCopy`,
        Depth: '0',
      }),
    })
    expect(replacedCollection.status).toBe(204)
  })

  it('COPY enforces destination locks and rolls back collection copy quota on storage failure', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await folder(db, workspace.id, { id: 'locked-target', name: 'LockedTarget' })
    await file(db, workspace.id, { id: 'copy-locked-source', name: 'locked-source.txt', size: 12 })

    const locked = await app.request(`/dav/${workspace.slug}/LockedTarget`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype><owner>tester</owner></lockinfo>',
    })
    expect(locked.status).toBe(200)

    const blocked = await app.request(`/dav/${workspace.slug}/locked-source.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/LockedTarget/locked-source.txt`,
      }),
    })
    expect(blocked.status).toBe(423)

    await folder(db, workspace.id, { id: 'rollback-source', name: 'RollbackSource' })
    await file(db, workspace.id, { id: 'rollback-file', name: 'data.bin', parent: 'RollbackSource', size: 12 })
    vi.mocked(S3Service.prototype.copyObject).mockRejectedValueOnce(new Error('copy failed'))

    const failed = await app.request(`/dav/${workspace.slug}/RollbackSource`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/RollbackCopy`,
        Depth: 'infinity',
      }),
    })
    expect(failed.status).toBe(500)
    const storageRows = await db.all<{ used: number }>(sql`SELECT used FROM storages WHERE id = ${storage.id}`)
    expect(storageRows[0]?.used).toBe(0)
    const partialRows = await db.all<{ name: string }>(
      sql`SELECT name FROM matters WHERE org_id = ${workspace.id} AND status = 'active' AND (name = 'RollbackCopy' OR parent LIKE 'RollbackCopy%')`,
    )
    expect(partialRows).toEqual([])
  })

  it('MOVE keeps collection descendant paths consistent and rejects descendant moves [spec: webdav/move-descendants]', async () => {
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

  it('write methods enforce WebDAV If and lock preconditions before mutations [spec: webdav/lock-preconditions]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await file(db, workspace.id, { id: 'guarded-file', name: 'guarded.txt' })
    await file(db, workspace.id, { id: 'move-guarded-file', name: 'move-guarded.txt' })
    await file(db, workspace.id, { id: 'copy-guarded-file', name: 'copy-guarded.txt' })
    await file(db, workspace.id, { id: 'delete-guarded-file', name: 'delete-guarded.txt' })

    const proppatchIfFailed = await app.request(`/dav/${workspace.slug}/guarded.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { If: '(["stale"])', 'Content-Type': 'application/xml' }),
      body: '<propertyupdate xmlns="DAV:" xmlns:Z="urn:zpan:test"><set><prop><Z:color>blue</Z:color></prop></set></propertyupdate>',
    })
    expect(proppatchIfFailed.status).toBe(412)

    const mkcolIfFailed = await app.request(`/dav/${workspace.slug}/BlockedByIf`, {
      method: 'MKCOL',
      headers: basicHeaders(account.email, key, { If: '(["stale"])' }),
    })
    expect(mkcolIfFailed.status).toBe(412)

    const deleteIfFailed = await app.request(`/dav/${workspace.slug}/delete-guarded.txt`, {
      method: 'DELETE',
      headers: basicHeaders(account.email, key, { If: '(["stale"])' }),
    })
    expect(deleteIfFailed.status).toBe(412)

    const moveIfFailed = await app.request(`/dav/${workspace.slug}/move-guarded.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/moved-guarded.txt`,
        If: '(["stale"])',
      }),
    })
    expect(moveIfFailed.status).toBe(412)

    const moveToSelf = await app.request(`/dav/${workspace.slug}/move-guarded.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/move-guarded.txt`,
      }),
    })
    expect(moveToSelf.status).toBe(204)

    const copyIfFailed = await app.request(`/dav/${workspace.slug}/copy-guarded.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/copied-guarded.txt`,
        If: '(["stale"])',
      }),
    })
    expect(copyIfFailed.status).toBe(412)

    const lock = await app.request(`/dav/${workspace.slug}/guarded.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(lock.status).toBe(200)

    const deleteLocked = await app.request(`/dav/${workspace.slug}/guarded.txt`, {
      method: 'DELETE',
      headers: basicHeaders(account.email, key),
    })
    expect(deleteLocked.status).toBe(423)
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
    const rows = await db.all<{ id: string; trashed_at: number | null }>(
      sql`SELECT id, trashed_at FROM matters WHERE id IN ('delete-folder', 'delete-file') ORDER BY id`,
    )
    // Soft delete cascades trashedAt to the whole subtree (status stays active).
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.trashed_at !== null)).toBe(true)
  })

  it('moves, copies, and deletes WebDAV dead properties and locks with namespace changes', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'state-file', name: 'state.txt' })

    const patch = await app.request(`/dav/${workspace.slug}/state.txt`, {
      method: 'PROPPATCH',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<propertyupdate xmlns="DAV:" xmlns:Z="urn:zpan:test"><set><prop><Z:color>green</Z:color></prop></set></propertyupdate>',
    })
    expect(patch.status).toBe(207)

    const lock = await app.request(`/dav/${workspace.slug}/state.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype><owner>tester</owner></lockinfo>',
    })
    expect(lock.status).toBe(200)
    const token = lock.headers.get('Lock-Token') ?? ''

    const moved = await app.request(`/dav/${workspace.slug}/state.txt`, {
      method: 'MOVE',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/moved-state.txt`,
        'Lock-Token': token,
      }),
    })
    expect(moved.status).toBe(201)

    const movedProps = await app.request(`/dav/${workspace.slug}/moved-state.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<propfind xmlns="DAV:" xmlns:Z="urn:zpan:test"><prop><Z:color/><lockdiscovery/></prop></propfind>',
    })
    const movedXml = await movedProps.text()
    expect(movedXml).toContain('green</Z:color>')
    expect(movedXml).toContain(token.slice(1, -1))

    const copied = await app.request(`/dav/${workspace.slug}/moved-state.txt`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/copied-state.txt`,
        'Lock-Token': token,
      }),
    })
    expect(copied.status).toBe(201)

    const copiedProps = await app.request(`/dav/${workspace.slug}/copied-state.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<propfind xmlns="DAV:" xmlns:Z="urn:zpan:test"><prop><Z:color/><lockdiscovery/></prop></propfind>',
    })
    const copiedXml = await copiedProps.text()
    expect(copiedXml).toContain('green</Z:color>')
    expect(copiedXml).not.toContain(token.slice(1, -1))

    const del = await app.request(`/dav/${workspace.slug}/moved-state.txt`, {
      method: 'DELETE',
      headers: basicHeaders(account.email, key, { 'Lock-Token': token }),
    })
    expect(del.status).toBe(204)

    const recreate = await app.request(`/dav/${workspace.slug}/moved-state.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain', 'Content-Length': '3' }),
      body: 'new',
    })
    expect(recreate.status).toBe(201)

    const stale = await app.request(`/dav/${workspace.slug}/moved-state.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<propfind xmlns="DAV:" xmlns:Z="urn:zpan:test"><prop><Z:color/><lockdiscovery/></prop></propfind>',
    })
    const staleXml = await stale.text()
    expect(staleXml).toContain('HTTP/1.1 404 Not Found')
    expect(staleXml).not.toContain(token.slice(1, -1))
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
    const firstEtag = head.headers.get('ETag') ?? ''

    const taggedMatch = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: `<http://localhost/dav/${workspace.slug}/if.txt> ([${firstEtag}])`,
        'Content-Type': 'text/plain',
        'Content-Length': '6',
      }),
      body: 'tagged',
    })
    expect(taggedMatch.status).toBe(204)

    const updatedHead = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    const etag = updatedHead.headers.get('ETag') ?? ''

    const matched = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: `([${etag}])`,
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      }),
      body: 'matched',
    })
    expect(matched.status).toBe(204)

    const missed = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { If: '(["stale"])', 'Content-Type': 'text/plain' }),
      body: 'missed',
    })
    expect(missed.status).toBe(412)

    const randomLockToken = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: '(<opaquelocktoken:random>)',
        'Content-Type': 'text/plain',
      }),
      body: 'missed',
    })
    expect(randomLockToken.status).toBe(412)

    const taggedExternalResource = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: '<https://example.com/dav/elsewhere> (<opaquelocktoken:random>)',
        'Content-Type': 'text/plain',
      }),
      body: 'missed',
    })
    expect(taggedExternalResource.status).toBe(412)

    const tokenTaggedResource = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: '<opaquelocktoken:random> (["stale"])',
        'Content-Type': 'text/plain',
      }),
      body: 'missed',
    })
    expect(tokenTaggedResource.status).toBe(412)

    const emptyStateList = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { If: '()', 'Content-Type': 'text/plain' }),
      body: 'missed',
    })
    expect(emptyStateList.status).toBe(412)

    const malformedTaggedUrl = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: '<http://[::1> (["stale"])',
        'Content-Type': 'text/plain',
      }),
      body: 'missed',
    })
    expect(malformedTaggedUrl.status).toBe(412)

    const invalidSyntax = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { If: 'Not a state list', 'Content-Type': 'text/plain' }),
      body: 'missed',
    })
    expect(invalidSyntax.status).toBe(412)

    const notMatched = await app.request(`/dav/${workspace.slug}/if.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: '(Not ["stale"])',
        'Content-Type': 'text/plain',
        'Content-Length': '11',
      }),
      body: 'not matched',
    })
    expect(notMatched.status).toBe(204)
  })

  it('LOCK and UNLOCK expose Class 2 state and enforce write tokens [spec: webdav/lock-unlock]', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await file(db, workspace.id, { id: 'lock-file', name: 'locked.txt', size: 12 })
    await file(db, workspace.id, { id: 'other-lock-file', name: 'other-locked.txt', size: 12 })

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
      headers: basicHeaders(account.email, key, {
        'Lock-Token': token,
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      }),
      body: 'allowed',
    })
    expect(accepted.status).toBe(204)

    const acceptedWithIfToken = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, {
        If: `(${token})`,
        'Content-Type': 'text/plain',
        'Content-Length': '13',
      }),
      body: 'allowed by if',
    })
    expect(acceptedWithIfToken.status).toBe(204)

    const refreshed = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, Timeout: 'Second-1200' }),
    })
    expect(refreshed.status).toBe(200)
    expect(refreshed.headers.get('Lock-Token')).toBeNull()

    const refreshWithBody = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(refreshWithBody.status).toBe(400)

    const refreshWithMultipleTokens = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, {
        If: `(${token})(<opaquelocktoken:extra>)`,
        Timeout: 'Second-1200',
      }),
    })
    expect(refreshWithMultipleTokens.status).toBe(400)

    const conflictingLock = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(conflictingLock.status).toBe(423)

    const wrongResourceRefresh = await app.request(`/dav/${workspace.slug}/other-locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, Timeout: 'Second-1200' }),
    })
    expect(wrongResourceRefresh.status).toBe(412)

    const badRefresh = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: '(<opaquelocktoken:missing>)' }),
    })
    expect(badRefresh.status).toBe(412)

    const shared = await app.request(`/dav/${workspace.slug}/other-locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><shared/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(shared.status).toBe(422)

    const malformedLock = await app.request(`/dav/${workspace.slug}/other-locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope></lockinfo>',
    })
    expect(malformedLock.status).toBe(422)

    const unsupportedDepth = await app.request(`/dav/${workspace.slug}/other-locked.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { Depth: '1', 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(unsupportedDepth.status).toBe(400)

    const missingLockTarget = await app.request(`/dav/${workspace.slug}/missing-lock-target.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(missingLockTarget.status).toBe(201)
    const createdToken = missingLockTarget.headers.get('Lock-Token') ?? ''
    expect(createdToken).toMatch(/^<opaquelocktoken:/)
    expect(await missingLockTarget.text()).toContain('lockdiscovery')

    const createdHead = await app.request(`/dav/${workspace.slug}/missing-lock-target.txt`, {
      method: 'HEAD',
      headers: basicHeaders(account.email, key),
    })
    expect(createdHead.status).toBe(200)
    expect(createdHead.headers.get('Content-Length')).toBe('0')

    const missingLockParent = await app.request(`/dav/${workspace.slug}/Missing/missing-lock-target.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype></lockinfo>',
    })
    expect(missingLockParent.status).toBe(409)

    const missingUnlockToken = await app.request(`/dav/${workspace.slug}/locked.txt`, {
      method: 'UNLOCK',
      headers: basicHeaders(account.email, key),
    })
    expect(missingUnlockToken.status).toBe(400)

    const missingUnlockTarget = await app.request(`/dav/${workspace.slug}/absent-unlock-target.txt`, {
      method: 'UNLOCK',
      headers: basicHeaders(account.email, key, { 'Lock-Token': token }),
    })
    expect(missingUnlockTarget.status).toBe(404)

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
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain', 'Content-Length': '5' }),
      body: 'after',
    })
    expect(afterUnlock.status).toBe(204)
  })

  it('LOCK refresh accepts descendant URLs inside a depth-infinity lock scope only', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const secondWorkspace = await teamWorkspace(db, {
      id: 'refresh-other-workspace',
      slug: 'refresh-other-workspace',
      userId: account.id,
      name: 'Refresh Other Workspace',
    })
    const key = await apiKey(auth, account.id, { webdav: ['write'] })
    await folder(db, workspace.id, { id: 'refresh-folder', name: 'RefreshScope' })
    await file(db, workspace.id, { id: 'refresh-child', name: 'child.txt', parent: 'RefreshScope' })
    await file(db, workspace.id, { id: 'refresh-outside', name: 'outside.txt' })
    await folder(db, secondWorkspace.id, { id: 'refresh-other-folder', name: 'RefreshScope' })
    await file(db, secondWorkspace.id, {
      id: 'refresh-other-child',
      name: 'child.txt',
      parent: 'RefreshScope',
    })

    const locked = await app.request(`/dav/${workspace.slug}/RefreshScope`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype><owner>tester</owner></lockinfo>',
    })
    expect(locked.status).toBe(200)
    const token = locked.headers.get('Lock-Token') ?? ''

    const descendantRefresh = await app.request(`/dav/${workspace.slug}/RefreshScope/child.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, Timeout: 'Second-1200' }),
    })
    expect(descendantRefresh.status).toBe(200)
    expect(descendantRefresh.headers.get('Lock-Token')).toBeNull()
    expect(await descendantRefresh.text()).toContain(token.slice(1, -1))

    const outsideRefresh = await app.request(`/dav/${workspace.slug}/outside.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, Timeout: 'Second-1200' }),
    })
    expect(outsideRefresh.status).toBe(412)

    const otherWorkspaceRefresh = await app.request(`/dav/${secondWorkspace.slug}/RefreshScope/child.txt`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { If: `(${token})`, Timeout: 'Second-1200' }),
    })
    expect(otherWorkspaceRefresh.status).toBe(412)

    const outsideUnlock = await app.request(`/dav/${workspace.slug}/outside.txt`, {
      method: 'UNLOCK',
      headers: basicHeaders(account.email, key, { 'Lock-Token': token }),
    })
    expect(outsideUnlock.status).toBe(409)

    const descendantUnlock = await app.request(`/dav/${workspace.slug}/RefreshScope/child.txt`, {
      method: 'UNLOCK',
      headers: basicHeaders(account.email, key, { 'Lock-Token': token }),
    })
    expect(descendantUnlock.status).toBe(204)

    const afterDescendantUnlock = await app.request(`/dav/${workspace.slug}/RefreshScope/child.txt`, {
      method: 'PUT',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'text/plain', 'Content-Length': '12' }),
      body: 'after unlock',
    })
    expect(afterDescendantUnlock.status).toBe(204)
  })

  it('PROPFIND lockdiscovery includes inherited depth-infinity locks', async () => {
    const { app, db, auth } = await createTestApp()
    await authedHeaders(app)
    await seedStorage(db)
    const workspace = await org(db)
    const account = await userAccount(db)
    const key = await apiKey(auth, account.id, { webdav: ['read', 'write'] })
    await folder(db, workspace.id, { id: 'discovery-folder', name: 'DiscoveryScope' })
    await file(db, workspace.id, { id: 'discovery-child', name: 'child.txt', parent: 'DiscoveryScope' })

    const locked = await app.request(`/dav/${workspace.slug}/DiscoveryScope`, {
      method: 'LOCK',
      headers: basicHeaders(account.email, key, { 'Content-Type': 'application/xml' }),
      body: '<lockinfo xmlns="DAV:"><lockscope><exclusive/></lockscope><locktype><write/></locktype><owner>tester &amp; maintainer</owner></lockinfo>',
    })
    expect(locked.status).toBe(200)
    const token = locked.headers.get('Lock-Token') ?? ''

    const childProps = await app.request(`/dav/${workspace.slug}/DiscoveryScope/child.txt`, {
      method: 'PROPFIND',
      headers: basicHeaders(account.email, key, { Depth: '0', 'Content-Type': 'application/xml' }),
      body: '<propfind xmlns="DAV:"><prop><lockdiscovery/></prop></propfind>',
    })
    expect(childProps.status).toBe(207)
    const xml = await childProps.text()
    expect(xml).toContain(token.slice(1, -1))
    expect(xml).toContain('<D:depth>infinity</D:depth>')
    expect(xml).toContain('<D:owner>tester &amp; maintainer</D:owner>')
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

  it('MOVE honors Overwrite header for existing destinations [spec: webdav/move-overwrite]', async () => {
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
    expect(replaced.status).toBe(204)
    const rows = await db.all<{ id: string; name: string; status: string; trashed_at: number | null }>(
      sql`SELECT id, name, status, trashed_at FROM matters WHERE id IN ('move-source', 'move-target') ORDER BY id`,
    )
    // The moved row is live; the overwritten destination is trashed (active + trashedAt).
    expect(rows).toEqual([
      { id: 'move-source', name: 'move-target.txt', status: 'active', trashed_at: null },
      expect.objectContaining({ id: 'move-target', name: 'move-target.txt', status: 'active' }),
    ])
    expect(rows[1].trashed_at).not.toBeNull()
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
    expect(replaced.status).toBe(204)
    const rows = await db.all<{ trashed_at: number | null }>(
      sql`SELECT trashed_at FROM matters WHERE id = 'copy-target'`,
    )
    // The overwritten destination is trashed (active + trashedAt).
    expect(rows[0]?.trashed_at).not.toBeNull()

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

    const collectionReplacement = await app.request(`/dav/${workspace.slug}/Copy%20Folder`, {
      method: 'COPY',
      headers: basicHeaders(account.email, key, {
        Destination: `http://localhost/dav/${workspace.slug}/Copied%20Folder`,
        Depth: '0',
      }),
    })
    expect(collectionReplacement.status).toBe(204)
  })

  it('COPY rolls back quota reservation when storage copy fails [spec: webdav/copy-rollback]', async () => {
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

  it('rejects traversal, empty segments, and encoded path separators [spec: webdav/path-validation]', async () => {
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

describe('WebDAV over real HTTP (npm client)', () => {
  const e2eStorage = {
    id: 'webdav-e2e-storage',
    bucket: 'webdav-e2e-bucket',
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    accessKey: 'key',
    secretKey: 'secret',
    filePath: '',
    customHost: '',
    capacity: 0,
    used: 0,
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const objects = new Map<string, Uint8Array>()

  let app: TestApp['app']
  let db: TestApp['db']
  let auth: TestApp['auth']
  let server: ReturnType<typeof serve>
  let baseUrl: string
  let workspaceName: string
  let workspaceSlug: string
  let username: string
  let apiKey: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    objects.clear()
    installS3MemoryBackend()

    ;({ app, db, auth } = await createTestApp())
    await authedHeaders(app, 'webdav-e2e@example.com', 'password123456')
    await db.insert(storages).values(e2eStorage)

    const [user] = await db.all<{ id: string; email: string }>(
      sql`SELECT id, email FROM user WHERE email = 'webdav-e2e@example.com'`,
    )
    const [workspace] = await db.all<{ id: string; name: string; slug: string }>(
      sql`SELECT id, name, slug FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    if (!user || !workspace) throw new Error('Failed to seed WebDAV e2e user')

    username = user.email
    workspaceName = workspace.name
    workspaceSlug = workspace.slug
    apiKey = (
      await (auth.api as { createApiKey(input: unknown): Promise<{ key: string }> }).createApiKey({
        body: { configId: 'webdav', userId: user.id, permissions: { webdav: ['read', 'write'] } },
      })
    ).key

    const port = await freePort()
    server = serve({ fetch: app.fetch, port })
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  })

  it('exercises Class 1 and Class 2 methods over real HTTP', async () => {
    const unauth = await rawDav('OPTIONS', '/dav/')
    expect(unauth.status).toBe(401)
    expect(unauth.headers.get('WWW-Authenticate')).toBe('Basic realm="ZPan WebDAV"')

    const options = await dav('OPTIONS', '/dav/')
    expect(options.status).toBe(204)
    expect(options.headers.get('DAV')).toContain('1')
    expect(options.headers.get('DAV')).toContain('2')
    expect(options.headers.get('Allow')).toContain('PROPFIND')
    expect(options.headers.get('Allow')).toContain('LOCK')

    const root = await dav('PROPFIND', '/dav/', {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: allpropXml(),
    })
    expect(root.status).toBe(207)
    expect(await root.text()).toContain(escapedDavHref(workspaceName))

    const mkcol = await dav('MKCOL', ws('/Albums'))
    expect(mkcol.status).toBe(201)

    const smallBody = new TextEncoder().encode('0123456789abcdefghijklmnopqrstuvwxyz')
    const putSmall = await dav('PUT', ws('/song.mp3'), {
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(smallBody.byteLength) },
      body: smallBody,
    })
    expect(putSmall.status).toBe(201)

    const largeSize = 2 * 1024 * 1024 + 123
    const putLarge = await dav('PUT', ws('/Albums/large.bin'), {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(largeSize) },
      body: patternedStream(largeSize),
    })
    expect(putLarge.status).toBe(201)

    const head = await dav('HEAD', ws('/song.mp3'))
    expect(head.status).toBe(200)
    expect(head.headers.get('Accept-Ranges')).toBe('bytes')
    expect(head.headers.get('Content-Length')).toBe(String(smallBody.byteLength))
    const etag = head.headers.get('ETag')
    expect(etag).toBeTruthy()

    const full = await dav('GET', ws('/song.mp3'))
    expect(full.status).toBe(200)
    expect(await full.text()).toBe('0123456789abcdefghijklmnopqrstuvwxyz')

    const range = await dav('GET', ws('/song.mp3'), { headers: { Range: 'bytes=10-15' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('Content-Range')).toBe(`bytes 10-15/${smallBody.byteLength}`)
    expect(await range.text()).toBe('abcdef')

    const multiRange = await dav('GET', ws('/song.mp3'), { headers: { Range: 'bytes=0-1,10-11' } })
    expect(multiRange.status).toBe(206)
    expect(multiRange.headers.get('Content-Type')).toMatch(/^multipart\/byteranges; boundary=zpan-webdav-/)
    expect(await multiRange.text()).toContain('Content-Range: bytes 10-11/36\r\n\r\nab')

    const largeTail = await dav('GET', ws('/Albums/large.bin'), { headers: { Range: `bytes=${largeSize - 4}-` } })
    expect(largeTail.status).toBe(206)
    expect(new Uint8Array(await largeTail.arrayBuffer())).toEqual(patternedBytes(largeSize - 4, 4))

    const webDavFsRange = await dav('GET', ws('/song.mp3'), {
      headers: { Range: 'bytes=10-10', 'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.6.0 (arm64)' },
    })
    expect(webDavFsRange.status).toBe(206)
    expect(webDavFsRange.headers.get('Content-Range')).toBe(`bytes 10-10/${smallBody.byteLength}`)
    expect(webDavFsRange.headers.get('Cache-Control')).toBe('no-store')
    expect(webDavFsRange.headers.get('ETag')).toBeNull()
    expect(await webDavFsRange.text()).toBe('a')

    const normalCached = await dav('GET', ws('/song.mp3'), { headers: { 'If-None-Match': etag ?? '' } })
    expect(normalCached.status).toBe(304)

    const mountedCached = await dav('GET', ws('/song.mp3'), {
      headers: {
        'If-None-Match': etag ?? '',
        'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.6.0 (arm64)',
      },
    })
    expect(mountedCached.status).toBe(200)
    expect(mountedCached.headers.get('Cache-Control')).toBe('no-store')
    expect(mountedCached.headers.get('ETag')).toBeNull()
    expect(await mountedCached.text()).toBe('0123456789abcdefghijklmnopqrstuvwxyz')

    const setProp = await dav('PROPPATCH', ws('/song.mp3'), {
      headers: { 'Content-Type': 'application/xml' },
      body: propertyUpdateXml('set'),
    })
    expect(setProp.status).toBe(207)

    const propfind = await dav('PROPFIND', ws('/song.mp3'), {
      headers: { Depth: '0', 'Content-Type': 'application/xml' },
      body: propfindXml(),
    })
    expect(propfind.status).toBe(207)
    expect(await propfind.text()).toContain('>five</Z:rating>')

    const removeProp = await dav('PROPPATCH', ws('/song.mp3'), {
      headers: { 'Content-Type': 'application/xml' },
      body: propertyUpdateXml('remove'),
    })
    expect(removeProp.status).toBe(207)

    const lock = await dav('LOCK', ws('/Albums'), {
      headers: { Depth: 'infinity', Timeout: 'Second-1200', 'Content-Type': 'application/xml' },
      body: lockInfoXml(),
    })
    expect(lock.status).toBe(200)
    const lockToken = lock.headers.get('Lock-Token')
    expect(lockToken).toMatch(/^<opaquelocktoken:/)

    const lockedPut = await dav('PUT', ws('/Albums/locked.txt'), {
      headers: { 'Content-Type': 'text/plain', 'Content-Length': '6' },
      body: 'locked',
    })
    expect(lockedPut.status).toBe(423)

    const unlockedPut = await dav('PUT', ws('/Albums/locked.txt'), {
      headers: { 'Content-Type': 'text/plain', 'Content-Length': '6', If: `(${lockToken})` },
      body: 'locked',
    })
    expect(unlockedPut.status).toBe(201)

    const unlock = await dav('UNLOCK', ws('/Albums'), { headers: { 'Lock-Token': lockToken ?? '' } })
    expect(unlock.status).toBe(204)

    const copy = await dav('COPY', ws('/song.mp3'), {
      headers: { Destination: `${baseUrl}${ws('/Albums/copy.mp3')}` },
    })
    expect(copy.status).toBe(201)
    expect(await (await dav('GET', ws('/Albums/copy.mp3'))).text()).toBe('0123456789abcdefghijklmnopqrstuvwxyz')

    const move = await dav('MOVE', ws('/Albums/copy.mp3'), {
      headers: { Destination: `${baseUrl}${ws('/Albums/moved.mp3')}` },
    })
    expect(move.status).toBe(201)
    expect((await dav('GET', ws('/Albums/copy.mp3'))).status).toBe(404)
    expect(await (await dav('GET', ws('/Albums/moved.mp3'))).text()).toBe('0123456789abcdefghijklmnopqrstuvwxyz')

    const listing = await dav('PROPFIND', ws('/Albums/'), {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: allpropXml(),
    })
    expect(listing.status).toBe(207)
    const listingXml = await listing.text()
    expect(listingXml).toContain('large.bin')
    expect(listingXml).toContain('locked.txt')
    expect(listingXml).toContain('moved.mp3')

    const del = await dav('DELETE', ws('/Albums/moved.mp3'))
    expect(del.status).toBe(204)
    expect((await dav('GET', ws('/Albums/moved.mp3'))).status).toBe(404)
  })

  it('works with the webdav npm client over real HTTP', async () => {
    const client = createClient(`${baseUrl}/dav`, { username, password: apiKey })
    const root = await client.getDirectoryContents('/')
    expect(root).toEqual(
      expect.arrayContaining([expect.objectContaining({ filename: `/${workspaceName}`, type: 'directory' })]),
    )

    const dir = `/${workspaceSlug}/Library Client`
    await client.createDirectory(dir)
    await client.putFileContents(`${dir}/client.txt`, 'hello mature client', { contentLength: true })

    const stat = (await client.stat(`${dir}/client.txt`)) as { size: number }
    expect(stat.size).toBe('hello mature client'.length)

    const full = await client.getFileContents(`${dir}/client.txt`, { format: 'text' })
    expect(full).toBe('hello mature client')

    const partial = (await client.getFileContents(`${dir}/client.txt`, {
      details: true,
      format: 'text',
      headers: { Range: 'bytes=6-11' },
    })) as { status: number; data: string }
    expect(partial.status).toBe(206)
    expect(partial.data).toBe('mature')

    const largeSize = 512 * 1024 + 7
    await client.putFileContents(`${dir}/stream.bin`, patternedNodeStream(largeSize), { contentLength: largeSize })
    expect(((await client.stat(`${dir}/stream.bin`)) as { size: number }).size).toBe(largeSize)

    await client.copyFile(`${dir}/client.txt`, `${dir}/copy.txt`)
    expect(await client.exists(`${dir}/copy.txt`)).toBe(true)
    await client.moveFile(`${dir}/copy.txt`, `${dir}/moved.txt`)
    expect(await client.exists(`${dir}/copy.txt`)).toBe(false)
    expect(await client.exists(`${dir}/moved.txt`)).toBe(true)

    const lock = await client.lock(dir, { timeout: 'Second-1200' })
    expect(lock.token).toMatch(/^opaquelocktoken:/)
    await client.unlock(dir, lock.token)

    await client.deleteFile(dir)
    expect(await client.exists(dir)).toBe(false)
  })

  function ws(path: string): string {
    return `/dav/${workspaceSlug}${path}`
  }

  function dav(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    return rawDav(method, path, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`,
        ...init.headers,
      },
    })
  }

  function rawDav(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      method,
      duplex: init.body instanceof ReadableStream ? 'half' : undefined,
    } as RequestInit & { duplex?: 'half' })
  }

  function installS3MemoryBackend() {
    vi.spyOn(S3Service.prototype, 'putObject').mockImplementation(async (_storage, key, body) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer())
      objects.set(key, bytes)
      return bytes.byteLength
    })
    vi.spyOn(S3Service.prototype, 'getObjectBody').mockImplementation(async (_storage, key, range) => {
      const bytes = objects.get(key)
      if (!bytes) throw new Error(`Missing object ${key}`)
      const sliced = sliceRange(bytes, range)
      const body = new ArrayBuffer(sliced.byteLength)
      new Uint8Array(body).set(sliced)
      return new Response(body).body ?? new ReadableStream()
    })
    vi.spyOn(S3Service.prototype, 'copyObject').mockImplementation(async (_srcStorage, srcKey, _dstStorage, dstKey) => {
      const bytes = objects.get(srcKey)
      if (!bytes) throw new Error(`Missing object ${srcKey}`)
      objects.set(dstKey, new Uint8Array(bytes))
    })
    vi.spyOn(S3Service.prototype, 'deleteObject').mockImplementation(async (_storage, key) => {
      objects.delete(key)
    })
    vi.spyOn(S3Service.prototype, 'deleteObjects').mockImplementation(async (_storage, keys) => {
      for (const key of keys) objects.delete(key)
    })
  }

  function sliceRange(bytes: Uint8Array, range?: string): Uint8Array {
    if (!range) return bytes
    const match = /^bytes=(\d+)-(\d+)$/.exec(range)
    if (!match) throw new Error(`Unexpected range ${range}`)
    return bytes.slice(Number(match[1]), Number(match[2]) + 1)
  }

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createServer()
      probe.listen(0, () => {
        const address = probe.address() as AddressInfo
        probe.close((error) => (error ? reject(error) : resolve(address.port)))
      })
    })
  }

  function patternedStream(size: number): ReadableStream<Uint8Array> {
    let offset = 0
    return new ReadableStream({
      pull(controller) {
        if (offset >= size) {
          controller.close()
          return
        }
        const length = Math.min(64 * 1024, size - offset)
        controller.enqueue(patternedBytes(offset, length))
        offset += length
      },
    })
  }

  function patternedNodeStream(size: number): Readable {
    let offset = 0
    return new Readable({
      read() {
        if (offset >= size) {
          this.push(null)
          return
        }
        const length = Math.min(64 * 1024, size - offset)
        this.push(Buffer.from(patternedBytes(offset, length)))
        offset += length
      },
    })
  }

  function patternedBytes(offset: number, length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) bytes[i] = (offset + i) % 251
    return bytes
  }

  function allpropXml(): string {
    return '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>'
  }

  function propfindXml(): string {
    return [
      '<?xml version="1.0"?>',
      '<D:propfind xmlns:D="DAV:" xmlns:Z="urn:zpan:e2e">',
      '<D:prop><D:getetag/><Z:rating/></D:prop>',
      '</D:propfind>',
    ].join('')
  }

  function propertyUpdateXml(action: 'set' | 'remove'): string {
    const prop = '<D:prop><Z:rating xmlns:Z="urn:zpan:e2e">five</Z:rating></D:prop>'
    return `<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:"><D:${action}>${prop}</D:${action}></D:propertyupdate>`
  }

  function lockInfoXml(): string {
    return [
      '<?xml version="1.0"?>',
      '<D:lockinfo xmlns:D="DAV:">',
      '<D:lockscope><D:exclusive/></D:lockscope>',
      '<D:locktype><D:write/></D:locktype>',
      '<D:owner>webdav-e2e</D:owner>',
      '</D:lockinfo>',
    ].join('')
  }
})
