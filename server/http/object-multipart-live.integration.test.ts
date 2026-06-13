import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { authedHeaders, createTestApp } from '../test/setup.js'

describe('object multipart upload API with S3-compatible storage', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()))
    })
    server = undefined
  })

  it('uploads a small object through the multipart API without a large fixture', async () => {
    const s3 = await startMultipartS3Mock()
    server = s3.server
    const { app, db } = await createTestApp()
    await insertStorage(db, s3.endpoint)
    const headers = await authedHeaders(app)

    const createRes = await app.request('/api/objects', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'multipart-smoke.txt',
        type: 'text/plain',
        size: 11,
        parent: '',
      }),
    })
    expect(createRes.status).toBe(201)
    const object = (await createRes.json()) as { id: string }

    const sessionRes = await app.request(`/api/objects/${object.id}/uploads`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partSize: 5 * 1024 * 1024 }),
    })
    expect(sessionRes.status).toBe(201)
    const session = (await sessionRes.json()) as { id: string; uploadId: string }
    expect(session.uploadId).toBeTruthy()

    const partsRes = await app.request(`/api/objects/${object.id}/uploads/${session.id}/parts`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ partNumbers: [1] }),
    })
    expect(partsRes.status).toBe(200)
    const presigned = (await partsRes.json()) as { parts: Array<{ partNumber: number; url: string }> }
    expect(presigned.parts).toHaveLength(1)

    const partRes = await fetch(presigned.parts[0].url, { method: 'PUT', body: 'hello world' })
    expect(partRes.status).toBe(200)
    const etag = partRes.headers.get('etag')
    expect(etag).toBeTruthy()

    const completeRes = await app.request(`/api/objects/${object.id}/uploads/${session.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', parts: [{ partNumber: 1, etag }] }),
    })
    expect(completeRes.status).toBe(200)

    const confirmRes = await app.request(`/api/objects/${object.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    })
    expect(confirmRes.status).toBe(200)

    const objectRes = await app.request(`/api/objects/${object.id}`, { headers })
    expect(objectRes.status).toBe(200)
    const active = (await objectRes.json()) as { downloadUrl: string }
    const downloadRes = await fetch(active.downloadUrl)
    expect(downloadRes.status).toBe(200)
    await expect(downloadRes.text()).resolves.toBe('hello world')
  })
})

async function insertStorage(db: Awaited<ReturnType<typeof createTestApp>>['db'], endpoint: string) {
  const now = Date.now()
  await db.run(sql`
    INSERT INTO storages (
      id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, status, egress_credit_billing_enabled, egress_credit_unit_bytes,
      egress_credit_per_unit, created_at, updated_at
    )
    VALUES (
      'multipart-live-storage', 'Multipart Live Storage', 'private', 'test-bucket',
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
