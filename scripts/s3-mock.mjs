import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const port = Number(process.env.E2E_S3_MOCK_PORT ?? 9191)
const objects = new Map()
const uploads = new Map()

const server = createServer(async (req, res) => {
  setCors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  try {
    await handleRequest(req, res)
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(error instanceof Error ? error.message : String(error))
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[s3-mock] listening on http://127.0.0.1:${port}`)
})

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const { bucket, key } = parsePath(url.pathname)

  if (url.pathname === '/health') {
    res.writeHead(200)
    res.end('ok')
    return
  }

  if (!bucket) {
    res.writeHead(200)
    res.end('')
    return
  }

  if (req.method === 'POST' && url.searchParams.has('uploads')) {
    createMultipartUpload(res, bucket, key)
    return
  }

  if (req.method === 'PUT' && url.searchParams.has('uploadId') && url.searchParams.has('partNumber')) {
    await uploadPart(req, res, url)
    return
  }

  if (req.method === 'POST' && url.searchParams.has('uploadId')) {
    completeMultipartUpload(res, url, bucket, key)
    return
  }

  if (req.method === 'DELETE' && url.searchParams.has('uploadId')) {
    uploads.delete(url.searchParams.get('uploadId'))
    res.writeHead(204)
    res.end()
    return
  }

  const objectKey = storageKey(bucket, key)
  if (req.method === 'PUT') {
    const body = await readBody(req)
    objects.set(objectKey, {
      body,
      contentType: req.headers['content-type'] ?? 'application/octet-stream',
    })
    res.writeHead(200, { etag: etag(body) })
    res.end('')
    return
  }

  if (req.method === 'HEAD') {
    const object = objects.get(objectKey)
    if (!object) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Length': object.body.byteLength,
      'Content-Type': object.contentType,
      etag: etag(object.body),
    })
    res.end()
    return
  }

  if (req.method === 'GET') {
    const object = objects.get(objectKey)
    if (!object) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    writeObject(res, object, req.headers.range)
    return
  }

  if (req.method === 'DELETE') {
    objects.delete(objectKey)
    res.writeHead(204)
    res.end()
    return
  }

  res.writeHead(405)
  res.end('Method not allowed')
}

function createMultipartUpload(res, bucket, key) {
  const uploadId = randomUUID()
  uploads.set(uploadId, { bucket, key, parts: new Map() })
  res.writeHead(200, { 'Content-Type': 'application/xml' })
  res.end(`<CreateMultipartUploadResult><UploadId>${uploadId}</UploadId></CreateMultipartUploadResult>`)
}

async function uploadPart(req, res, url) {
  const uploadId = url.searchParams.get('uploadId')
  const upload = uploads.get(uploadId)
  if (!upload) {
    res.writeHead(404)
    res.end('Upload not found')
    return
  }
  const partNumber = Number(url.searchParams.get('partNumber'))
  const body = await readBody(req)
  upload.parts.set(partNumber, body)
  res.writeHead(200, { etag: etag(body) })
  res.end('')
}

function completeMultipartUpload(res, url, bucket, key) {
  const uploadId = url.searchParams.get('uploadId')
  const upload = uploads.get(uploadId)
  if (!upload) {
    res.writeHead(404)
    res.end('Upload not found')
    return
  }

  const parts = [...upload.parts.entries()].sort(([left], [right]) => left - right)
  const total = parts.reduce((sum, [, part]) => sum + part.byteLength, 0)
  const body = new Uint8Array(total)
  let offset = 0
  for (const [, part] of parts) {
    body.set(part, offset)
    offset += part.byteLength
  }

  objects.set(storageKey(bucket, key), { body, contentType: 'application/octet-stream' })
  uploads.delete(uploadId)
  res.writeHead(200, { 'Content-Type': 'application/xml' })
  res.end('<CompleteMultipartUploadResult />')
}

function writeObject(res, object, rangeHeader) {
  if (!rangeHeader) {
    res.writeHead(200, {
      'Content-Length': object.body.byteLength,
      'Content-Type': object.contentType,
      etag: etag(object.body),
    })
    res.end(object.body)
    return
  }

  const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader)
  if (!match) {
    res.writeHead(416)
    res.end()
    return
  }

  const start = Number(match[1])
  const end = match[2] ? Number(match[2]) : object.body.byteLength - 1
  const slice = object.body.slice(start, end + 1)
  res.writeHead(206, {
    'Content-Length': slice.byteLength,
    'Content-Range': `bytes ${start}-${end}/${object.body.byteLength}`,
    'Content-Type': object.contentType,
    etag: etag(object.body),
  })
  res.end(slice)
}

function parsePath(pathname) {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  return {
    bucket: parts[0] ?? '',
    key: parts.slice(1).join('/'),
  }
}

function storageKey(bucket, key) {
  return `${bucket}/${key}`
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'ETag,Content-Length,Content-Range,Content-Type')
}

function etag(body) {
  return `"${createHash('md5').update(body).digest('hex')}"`
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return new Uint8Array(Buffer.concat(chunks))
}
