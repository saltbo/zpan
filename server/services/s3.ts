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
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    const client = this.createClient(storage)
    const command = new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ContentType: contentType,
    })
    return getSignedUrl(client, command, { expiresIn })
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
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    })
    return getSignedUrl(client, command, { expiresIn })
  }

  async presignInline(storage: Storage, key: string, mime: string, expiresIn = DEFAULT_EXPIRES_IN): Promise<string> {
    const client = this.createClient(storage)
    const command = new GetObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      ResponseContentDisposition: 'inline',
      ResponseContentType: mime,
    })
    return getSignedUrl(client, command, { expiresIn })
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
    const client = this.createClient(storage)
    const input = range ? { Bucket: storage.bucket, Key: key, Range: range } : { Bucket: storage.bucket, Key: key }
    const result = await client.send(new GetObjectCommand(input))
    if (!result.Body) throw new Error('Empty body from object')
    return bodyToBytes(result.Body)
  }

  async getObjectBody(storage: Storage, key: string, range?: string): Promise<BodyInit> {
    const client = this.createClient(storage)
    const input = range ? { Bucket: storage.bucket, Key: key, Range: range } : { Bucket: storage.bucket, Key: key }
    const result = await client.send(new GetObjectCommand(input))
    if (!result.Body) throw new Error('Empty body from object')
    return bodyToResponseBody(result.Body)
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
    const client = this.createClient(storage)
    const created = await client.send(
      new CreateMultipartUploadCommand({ Bucket: storage.bucket, Key: key, ContentType: contentType }),
    )
    const uploadId = created.UploadId
    if (!uploadId) throw new Error('S3 multipart upload did not return an upload id')

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
        await client.send(new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId }))
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

      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: storage.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      )
      return total
    } catch (e) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: storage.bucket, Key: key, UploadId: uploadId }))
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
    if (!result.ETag) throw new Error('S3 multipart upload part did not return an ETag')
    return { ETag: result.ETag, PartNumber: partNumber }
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
  if (body instanceof Uint8Array) return body
  if (body instanceof ReadableStream) return new Uint8Array(await new Response(body).arrayBuffer())

  const streamBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>
    arrayBuffer?: () => Promise<ArrayBuffer>
  }
  if (streamBody.transformToByteArray) return streamBody.transformToByteArray()
  if (streamBody.arrayBuffer) return new Uint8Array(await streamBody.arrayBuffer())

  throw new Error('Unsupported object body')
}

function bodyToResponseBody(body: unknown): BodyInit {
  if (body instanceof Uint8Array)
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  if (body instanceof ReadableStream) return body

  const streamBody = body as {
    transformToWebStream?: () => ReadableStream
  }
  if (streamBody.transformToWebStream) return streamBody.transformToWebStream()

  throw new Error('Unsupported object body')
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
