import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  NotFound,
  NoSuchKey,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Storage } from '@zpan/shared/types'
import type { StorageMode } from '@zpan/shared/constants'

const PRESIGN_EXPIRES_IN = 3600 // 1 hour

export function createS3Client(storage: {
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  forcePathStyle?: boolean
}): S3Client {
  return new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    credentials: {
      accessKeyId: storage.accessKey,
      secretAccessKey: storage.secretKey,
    },
    forcePathStyle: storage.forcePathStyle ?? false,
  })
}

export async function getUploadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRES_IN })
}

export async function getDownloadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  customHost?: string,
  mode?: StorageMode,
): Promise<string> {
  if (customHost && mode === 'public') {
    const host = customHost.replace(/\/+$/, '')
    return `${host}/${key}`
  }

  const command = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRES_IN })
}

export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ size: number; contentType: string } | null> {
  try {
    const response = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    )
    if (response.ContentLength == null) return null
    return {
      size: response.ContentLength,
      contentType: response.ContentType ?? 'application/octet-stream',
    }
  } catch (error: unknown) {
    if (error instanceof NotFound || error instanceof NoSuchKey) return null
    throw error
  }
}

export async function deleteObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

export async function deleteObjects(
  client: S3Client,
  bucket: string,
  keys: string[],
): Promise<void> {
  if (keys.length === 0) return

  const response = await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  )

  if (response.Errors && response.Errors.length > 0) {
    const failed = response.Errors.map((e) => `${e.Key}: ${e.Message}`).join(', ')
    throw new Error(`Failed to delete objects: ${failed}`)
  }
}

export async function copyObject(
  client: S3Client,
  bucket: string,
  sourceKey: string,
  destKey: string,
): Promise<void> {
  await client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${encodeURIComponent(sourceKey)}`,
      Key: destKey,
    }),
  )
}

// --- File Path Templating ---

export function expandFilePath(
  template: string,
  vars: { uid: string; rawName: string; rawExt: string; uuid: string },
): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')

  const rand16 = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const safeName = sanitizePathSegment(vars.rawName)

  return template
    .replace(/\$UID/g, vars.uid)
    .replace(/\$UUID/g, vars.uuid)
    .replace(/\$RAW_NAME/g, safeName)
    .replace(/\$RAW_EXT/g, vars.rawExt)
    .replace(/\$NOW_DATE/g, `${yyyy}/${mm}/${dd}`)
    .replace(/\$RAND_16KEY/g, rand16)
}

// --- Storage Selection ---

export type StorageWithMeta = Storage & {
  priority: number
  capacityBytes: number | null
  usedBytes: number
}

export function selectStorage(
  storages: StorageWithMeta[],
  mode: StorageMode,
  fileSize: number,
): StorageWithMeta | null {
  const candidates = storages
    .filter((s) => s.mode === mode && s.status === 1)
    .sort((a, b) => a.priority - b.priority)

  return (
    candidates.find((s) => {
      return s.capacityBytes == null || s.usedBytes + fileSize <= s.capacityBytes
    }) ?? null
  )
}

// --- Internal helpers ---

function sanitizePathSegment(name: string): string {
  return name.replace(/\.\./g, '_').replace(/[/\\]/g, '_')
}
