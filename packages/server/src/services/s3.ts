import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { nanoid } from 'nanoid'
import type { Storage } from '@zpan/shared'

const PRESIGN_EXPIRES_IN = 3600 // 1 hour

export function createS3Client(storage: {
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
}): S3Client {
  return new S3Client({
    endpoint: storage.endpoint,
    region: storage.region,
    credentials: {
      accessKeyId: storage.accessKey,
      secretAccessKey: storage.secretKey,
    },
    forcePathStyle: true,
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
  mode?: string,
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
    return {
      size: response.ContentLength ?? 0,
      contentType: response.ContentType ?? 'application/octet-stream',
    }
  } catch (error: unknown) {
    if (isNotFoundError(error)) return null
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

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  )
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
      CopySource: `${bucket}/${sourceKey}`,
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

  const rand16 = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)

  return template
    .replace(/\$UID/g, vars.uid)
    .replace(/\$UUID/g, vars.uuid)
    .replace(/\$RAW_NAME/g, vars.rawName)
    .replace(/\$RAW_EXT/g, vars.rawExt)
    .replace(/\$NOW_DATE/g, `${yyyy}/${mm}/${dd}`)
    .replace(/\$RAND_16KEY/g, rand16)
}

// --- Storage Selection ---

export function selectStorage(
  storages: Storage[],
  mode: 'private' | 'public',
  fileSize: number,
): Storage | null {
  const candidates = storages
    .filter((s) => s.mode === mode && s.status === 1)
    .sort((a, b) => (a as StorageWithPriority).priority - (b as StorageWithPriority).priority)

  return (
    candidates.find((s) => {
      const sq = s as StorageWithQuota
      return sq.capacityBytes == null || sq.usedBytes + fileSize <= sq.capacityBytes
    }) ?? null
  )
}

// --- Internal helpers ---

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotFound' || error.name === '404' || error.name === 'NoSuchKey')
  )
}

// Extended storage types for selection logic
type StorageWithPriority = Storage & { priority: number }
type StorageWithQuota = Storage & { capacityBytes: number | null; usedBytes: number }
