import type { AddressInfo } from 'node:net'
import { createServer } from 'node:net'
import { Readable } from 'node:stream'
import { serve } from '@hono/node-server'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient } from 'webdav'
import { storages } from '../db/schema.js'
import { S3Service } from '../services/s3.js'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestApp = Awaited<ReturnType<typeof createTestApp>>

const storage = {
  id: 'webdav-e2e-storage',
  title: 'WebDAV E2E Storage',
  mode: 'private',
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

describe('WebDAV HTTP e2e', () => {
  let app: TestApp['app']
  let db: TestApp['db']
  let auth: TestApp['auth']
  let server: ReturnType<typeof serve>
  let baseUrl: string
  let workspaceSlug: string
  let username: string
  let apiKey: string

  beforeEach(async () => {
    vi.restoreAllMocks()
    objects.clear()
    installS3MemoryBackend()

    ;({ app, db, auth } = await createTestApp())
    await authedHeaders(app, 'webdav-e2e@example.com', 'password123456')
    await db.insert(storages).values(storage)

    const [user] = await db.all<{ id: string; email: string }>(
      sql`SELECT id, email FROM user WHERE email = 'webdav-e2e@example.com'`,
    )
    const [workspace] = await db.all<{ id: string; slug: string }>(
      sql`SELECT id, slug FROM organization WHERE metadata LIKE '%"type":"personal"%' LIMIT 1`,
    )
    if (!user || !workspace) throw new Error('Failed to seed WebDAV e2e user')

    username = user.email
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
    expect(await root.text()).toContain(`/dav/${workspaceSlug}/`)

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

    const largeTail = await dav('GET', ws('/Albums/large.bin'), { headers: { Range: `bytes=${largeSize - 4}-` } })
    expect(largeTail.status).toBe(206)
    expect(new Uint8Array(await largeTail.arrayBuffer())).toEqual(patternedBytes(largeSize - 4, 4))

    const webDavFsRange = await dav('GET', ws('/song.mp3'), {
      headers: { Range: 'bytes=10-10', 'User-Agent': 'WebDAVFS/3.0.0 (03008000) Darwin/24.6.0 (arm64)' },
    })
    expect(webDavFsRange.status).toBe(206)
    expect(webDavFsRange.headers.get('Content-Range')).toBe(
      `bytes 10-${smallBody.byteLength - 1}/${smallBody.byteLength}`,
    )
    expect(webDavFsRange.headers.get('Cache-Control')).toBe('no-store')
    expect(webDavFsRange.headers.get('ETag')).toBeNull()
    expect(await webDavFsRange.text()).toBe('abcdefghijklmnopqrstuvwxyz')

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
      expect.arrayContaining([expect.objectContaining({ filename: `/${workspaceSlug}`, type: 'directory' })]),
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
})

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
    const server = createServer()
    server.listen(0, () => {
      const address = server.address() as AddressInfo
      server.close((error) => (error ? reject(error) : resolve(address.port)))
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
