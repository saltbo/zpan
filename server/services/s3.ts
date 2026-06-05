import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Storage } from '../../shared/types'

const DEFAULT_EXPIRES_IN = 3600
const MULTIPART_PART_SIZE = 5 * 1024 * 1024
const SMALL_STREAM_PUT_BUFFER_SIZE = 256 * 1024

export class S3Service {
  createClient(storage: Storage): S3Client {
    return new S3Client({
      region: storage.region,
      endpoint: storage.endpoint,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: storage.accessKey,
        secretAccessKey: storage.secretKey,
      },
      forcePathStyle: true,
    })
  }

  async presignUpload(
    storage: Storage,
    key: string,
    contentType: string,
    filenameOrExpiresIn?: string | number,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    let filename: string | undefined
    let ttl = expiresIn
    if (typeof filenameOrExpiresIn === 'string') {
      filename = filenameOrExpiresIn
    } else if (typeof filenameOrExpiresIn === 'number') {
      ttl = filenameOrExpiresIn
    }

    const client = this.createClient(storage)
    const command = new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ContentType: contentType,
      ...(filename
        ? {
            ContentDisposition: `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          }
        : {}),
    })
    const url = await getSignedUrl(client, command, { expiresIn: ttl })
    return url
  }

  async createMultipartUpload(storage: Storage, key: string, contentType: string): Promise<string> {
    const client = this.createClient(storage)
    const url = await getSignedUrl(
      client,
      new CreateMultipartUploadCommand({ Bucket: storage.bucket, Key: key, ContentType: contentType }),
      { expiresIn: DEFAULT_EXPIRES_IN },
    )
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': contentType } })
    const body = await response.text()
    if (!response.ok) throw new Error(`S3 multipart upload create failed: ${response.status}: ${body.trim()}`)
    const uploadId = xmlTag(body, 'UploadId')
    if (!uploadId) throw new Error('S3 multipart upload did not return an upload id')
    return uploadId
  }

  async presignUploadPart(
    storage: Storage,
    key: string,
    uploadId: string,
    partNumber: number,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    const client = this.createClient(storage)
    return getSignedUrl(
      client,
      new UploadPartCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn },
    )
  }

  async completeMultipartUpload(
    storage: Storage,
    key: string,
    uploadId: string,
    parts: Array<{ etag: string; partNumber: number }>,
  ): Promise<void> {
    const client = this.createClient(storage)
    const sortedParts = parts
      .map((part) => ({ ETag: part.etag, PartNumber: part.partNumber }))
      .sort((a, b) => a.PartNumber - b.PartNumber)
    const url = await getSignedUrl(
      client,
      new CompleteMultipartUploadCommand({
        Bucket: storage.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: sortedParts },
      }),
      { expiresIn: DEFAULT_EXPIRES_IN },
    )
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: multipartCompleteXml(sortedParts),
    })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`S3 multipart upload complete failed: ${response.status}: ${body.trim()}`)
    }
    if (xmlTag(body, 'Error') !== null || xmlTag(body, 'Code') !== null) {
      throw new Error(`S3 multipart upload complete failed: ${response.status}: ${body.trim()}`)
    }
  }

  async abortMultipartUpload(storage: Storage, key: string, uploadId: string): Promise<void> {
    const client = this.createClient(storage)
    const url = await getSignedUrl(
      client,
      new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId }),
      { expiresIn: DEFAULT_EXPIRES_IN },
    )
    const response = await fetch(url, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`S3 multipart upload abort failed: ${response.status}: ${body.trim()}`)
    }
  }

  async presignDownload(
    storage: Storage,
    key: string,
    filename: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    const client = this.createClient(storage)
    const command = new GetObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, '\\"')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    })
    const url = await getSignedUrl(client, command, { expiresIn })
    return this.applyCustomHost(storage, url)
  }

  async presignInline(storage: Storage, key: string, mime: string, expiresIn = DEFAULT_EXPIRES_IN): Promise<string> {
    const client = this.createClient(storage)
    const command = new GetObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: mime,
    })
    const url = await getSignedUrl(client, command, { expiresIn })
    return this.applyCustomHost(storage, url)
  }

  private applyCustomHost(storage: Storage, url: string): string {
    if (!storage.customHost) return url

    let customHost = storage.customHost.trim()
    if (!/^https?:\/\//i.test(customHost)) {
      customHost = `https://${customHost}`
    }

    const parsed = new URL(url)
    const custom = new URL(customHost)

    parsed.protocol = custom.protocol
    parsed.host = custom.host

    const bucketPrefix = `/${storage.bucket}/`
    if (parsed.pathname.startsWith(bucketPrefix)) {
      parsed.pathname = `/${parsed.pathname.slice(bucketPrefix.length)}`
    } else if (parsed.pathname === `/${storage.bucket}`) {
      parsed.pathname = '/'
    }

    return parsed.toString()
  }

  getPublicUrl(storage: Storage, key: string): string {
    if (storage.customHost) {
      return `${storage.customHost.replace(/\/$/, '')}/${key}`
    }
    return `${storage.endpoint.replace(/\/$/, '')}/${storage.bucket}/${key}`
  }

  async headObject(storage: Storage, key: string): Promise<{ size: number; contentType: string }> {
    const client = this.createClient(storage)
    const result = await client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key }))
    return {
      size: result.ContentLength ?? 0,
      contentType: result.ContentType ?? 'application/octet-stream',
    }
  }

  async getObjectBytes(storage: Storage, key: string, range?: string): Promise<Uint8Array> {
    return bodyToBytes(await this.getObjectBody(storage, key, range))
  }

  async getObjectBody(storage: Storage, key: string, range?: string): Promise<BodyInit> {
    const client = this.createClient(storage)
    const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: storage.bucket, Key: key }), {
      expiresIn: DEFAULT_EXPIRES_IN,
    })
    const response = await fetch(url, range ? { headers: { Range: range } } : undefined)
    if (!response.ok) throw new Error(`S3 object read failed: ${response.status}`)
    if (!response.body) return response.arrayBuffer()
    return response.body
  }

  async getObjectStream(storage: Storage, key: string, range?: string): Promise<ReadableStream<Uint8Array>> {
    const body = await this.getObjectBody(storage, key, range)
    return bodyToReadableStream(body)
  }

  async copyObject(srcStorage: Storage, srcKey: string, dstStorage: Storage, dstKey: string): Promise<void> {
    const client = this.createClient(dstStorage)
    await client.send(
      new CopyObjectCommand({
        CopySource: `${srcStorage.bucket}/${srcKey}`,
        Bucket: dstStorage.bucket,
        Key: dstKey,
      }),
    )
  }

  async streamCopy(srcStorage: Storage, srcKey: string, dstStorage: Storage, dstKey: string): Promise<void> {
    const srcClient = this.createClient(srcStorage)
    const getResult = await srcClient.send(new GetObjectCommand({ Bucket: srcStorage.bucket, Key: srcKey }))
    if (!getResult.Body) throw new Error('Empty body from source object')

    const dstClient = this.createClient(dstStorage)
    await dstClient.send(
      new PutObjectCommand({
        Bucket: dstStorage.bucket,
        Key: dstKey,
        // biome-ignore lint/suspicious/noExplicitAny: AWS SDK stream type differs across Node and CF Workers runtimes
        Body: getResult.Body as any,
        ContentType: getResult.ContentType,
        ContentLength: getResult.ContentLength,
      }),
    )
  }

  async putObject(
    storage: Storage,
    key: string,
    body: ReadableStream | Uint8Array,
    contentType: string,
    contentLength?: number,
  ): Promise<number> {
    if (body instanceof ReadableStream) {
      if (contentLength === undefined) return this.putObjectMultipartStream(storage, key, body, contentType)
      if (contentLength <= SMALL_STREAM_PUT_BUFFER_SIZE) {
        const bytes = await streamToBytes(body)
        if (bytes.byteLength !== contentLength) throw new Error('Request body length does not match Content-Length')
        return this.putObject(storage, key, bytes, contentType)
      }
      await this.putObjectStream(storage, key, body, contentType, contentLength)
      return contentLength
    }

    const client = this.createClient(storage)
    await client.send(
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    )
    return body.byteLength
  }

  private async putObjectStream(
    storage: Storage,
    key: string,
    body: ReadableStream,
    contentType: string,
    contentLength: number,
  ): Promise<void> {
    const url = await this.presignUpload(storage, key, contentType)
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(contentLength),
      },
      body,
    })
    if (!response.ok) throw new Error(`S3 stream upload failed: ${response.status}`)
  }

  private async putObjectMultipartStream(
    storage: Storage,
    key: string,
    body: ReadableStream,
    contentType: string,
  ): Promise<number> {
    const uploadId = await this.createMultipartUpload(storage, key, contentType)
    const client = this.createClient(storage)

    const reader = body.getReader()
    const parts: Array<{ ETag: string; PartNumber: number }> = []
    let pending = new Uint8Array() as Uint8Array<ArrayBufferLike>
    let total = 0

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        pending = concatBytes(pending, value)
        while (pending.byteLength >= MULTIPART_PART_SIZE) {
          const part = pending.slice(0, MULTIPART_PART_SIZE)
          pending = pending.slice(MULTIPART_PART_SIZE)
          parts.push(await this.uploadPart(client, storage.bucket, key, uploadId, parts.length + 1, part))
          total += part.byteLength
        }
      }

      if (pending.byteLength > 0) {
        parts.push(await this.uploadPart(client, storage.bucket, key, uploadId, parts.length + 1, pending))
        total += pending.byteLength
      }

      if (parts.length === 0) {
        await this.abortMultipartUpload(storage, key, uploadId)
        await client.send(
          new PutObjectCommand({
            Bucket: storage.bucket,
            Key: key,
            Body: new Uint8Array(),
            ContentType: contentType,
            ContentLength: 0,
          }),
        )
        return 0
      }

      await this.completeMultipartUpload(
        storage,
        key,
        uploadId,
        parts.map((part) => ({ etag: part.ETag, partNumber: part.PartNumber })),
      )
      return total
    } catch (e) {
      await this.abortMultipartUpload(storage, key, uploadId)
      throw e
    }
  }

  private async uploadPart(
    client: S3Client,
    bucket: string,
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array<ArrayBufferLike>,
  ): Promise<{ ETag: string; PartNumber: number }> {
    const result = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: body.byteLength,
      }),
    )
    return { ETag: result.ETag ?? `"part-${partNumber}"`, PartNumber: partNumber }
  }

  async deleteObject(storage: Storage, key: string): Promise<void> {
    const client = this.createClient(storage)
    await client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }))
  }

  async deleteObjects(storage: Storage, keys: string[]): Promise<void> {
    if (keys.length === 0) return
    // DeleteObjectsCommand returns XML which requires DOMParser to parse.
    // Cloudflare Workers doesn't have DOMParser, so we delete one-by-one.
    await Promise.all(keys.map((key) => this.deleteObject(storage, key)))
  }
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  const streamBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>
    arrayBuffer?: () => Promise<ArrayBuffer>
  }
  if (streamBody.transformToByteArray) return streamBody.transformToByteArray()
  if (body instanceof Uint8Array) return body
  if (body instanceof ReadableStream) return streamToBytes(body)
  if (streamBody.arrayBuffer) return new Uint8Array(await streamBody.arrayBuffer())

  throw new Error('Unsupported object body')
}

async function streamToBytes(body: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body).arrayBuffer())
}

function bodyToReadableStream(body: BodyInit): ReadableStream<Uint8Array> {
  if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>
  if (body instanceof Uint8Array) return bytesToStream(body)
  if (body instanceof ArrayBuffer) return bytesToStream(new Uint8Array(body))
  if (body instanceof Blob) return body.stream()
  throw new Error('Unsupported object body')
}

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function concatBytes(
  left: Uint8Array<ArrayBufferLike>,
  right: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
  if (left.byteLength === 0) return right
  const merged = new Uint8Array(left.byteLength + right.byteLength)
  merged.set(left)
  merged.set(right, left.byteLength)
  return merged
}

function multipartCompleteXml(parts: Array<{ ETag: string; PartNumber: number }>): string {
  return `<CompleteMultipartUpload>${parts
    .map((part) => `<Part><PartNumber>${part.PartNumber}</PartNumber><ETag>${xmlEscape(part.ETag)}</ETag></Part>`)
    .join('')}</CompleteMultipartUpload>`
}

function xmlTag(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<${escapedTag}>([\\s\\S]*?)</${escapedTag}>`).exec(xml)
  return match ? xmlUnescape(match[1].trim()) : null
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}
