import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Storage } from '../../shared/types'

const DEFAULT_EXPIRES_IN = 3600

export class S3Service {
  createClient(storage: Storage): S3Client {
    return new S3Client({
      region: storage.region,
      endpoint: storage.endpoint,
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

  async deleteObject(storage: Storage, key: string): Promise<void> {
    const client = this.createClient(storage)
    await client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }))
  }

  async deleteObjects(storage: Storage, keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const client = this.createClient(storage)
    await client.send(
      new DeleteObjectsCommand({
        Bucket: storage.bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }),
    )
  }
}
