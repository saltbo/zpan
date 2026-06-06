import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { downloaders, downloadTasks } from '../db/schema'
import type { Database, Platform } from '../platform/interface'

const TOKEN_VERSION = 1

const downloaderTokenSchema = z.object({
  v: z.literal(TOKEN_VERSION),
  typ: z.literal('downloader'),
  downloaderId: z.string().min(1),
  jti: z.string().min(1),
  iat: z.number().int(),
})

const taskUploadTokenSchema = z.object({
  v: z.literal(TOKEN_VERSION),
  typ: z.literal('download-task-upload'),
  taskId: z.string().min(1),
  downloaderId: z.string().min(1),
  orgId: z.string().min(1),
  targetFolder: z.string(),
  createdByUserId: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  jti: z.string().min(1),
  iat: z.number().int(),
  exp: z.number().int(),
})

export type DownloaderTokenClaims = z.infer<typeof downloaderTokenSchema>
export type TaskUploadTokenClaims = z.infer<typeof taskUploadTokenSchema>
export type DownloadTokenClaims = DownloaderTokenClaims | TaskUploadTokenClaims

export async function signDownloadToken(platform: Platform, claims: DownloadTokenClaims): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify(claims))
  const signature = await signPayload(platform, payload)
  return `${payload}.${signature}`
}

export async function verifyDownloadToken(platform: Platform, token: string): Promise<DownloadTokenClaims | null> {
  const [payload, signature, extra] = token.split('.')
  if (!payload || !signature || extra !== undefined) return null
  const expected = await signPayload(platform, payload)
  if (!constantTimeEqual(signature, expected)) return null
  let raw: unknown
  try {
    raw = JSON.parse(base64UrlDecode(payload))
  } catch {
    return null
  }
  const downloader = downloaderTokenSchema.safeParse(raw)
  if (downloader.success) return downloader.data
  const task = taskUploadTokenSchema.safeParse(raw)
  if (!task.success) return null
  if (task.data.exp <= Math.floor(Date.now() / 1000)) return null
  return task.data
}

export async function hashDownloadToken(platform: Platform, token: string): Promise<string> {
  const key = await hmacKey(secret(platform))
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`hash:${token}`))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

export async function resolveDownloaderToken(
  platform: Platform,
  token: string,
): Promise<{ downloaderId: string } | null> {
  const claims = await verifyDownloadToken(platform, token)
  if (!claims || claims.typ !== 'downloader') return null
  const hash = await hashDownloadToken(platform, token)
  const rows = await platform.db
    .select({
      id: downloaders.id,
      enabled: downloaders.enabled,
      tokenHash: downloaders.tokenHash,
      tokenJti: downloaders.tokenJti,
    })
    .from(downloaders)
    .where(eq(downloaders.id, claims.downloaderId))
    .limit(1)
  const row = rows[0]
  if (!row?.enabled || row.tokenHash !== hash || row.tokenJti !== claims.jti) return null
  return { downloaderId: row.id }
}

export async function resolveTaskUploadToken(
  db: Database,
  platform: Platform,
  token: string,
): Promise<TaskUploadTokenClaims | null> {
  const claims = await verifyDownloadToken(platform, token)
  if (!claims || claims.typ !== 'download-task-upload') return null
  const hash = await hashDownloadToken(platform, token)
  const rows = await db
    .select({
      id: downloadTasks.id,
      assignedDownloaderId: downloadTasks.assignedDownloaderId,
      status: downloadTasks.status,
      orgId: downloadTasks.orgId,
      targetFolder: downloadTasks.targetFolder,
      uploadTokenHash: downloadTasks.uploadTokenHash,
      uploadTokenJti: downloadTasks.uploadTokenJti,
      uploadTokenExpiresAt: downloadTasks.uploadTokenExpiresAt,
    })
    .from(downloadTasks)
    .where(eq(downloadTasks.id, claims.taskId))
    .limit(1)
  const task = rows[0]
  if (!task) return null
  if (task.assignedDownloaderId !== claims.downloaderId) return null
  if (task.orgId !== claims.orgId || task.targetFolder !== claims.targetFolder) return null
  if (task.uploadTokenHash !== hash || task.uploadTokenJti !== claims.jti) return null
  if (task.uploadTokenExpiresAt && task.uploadTokenExpiresAt.getTime() <= Date.now()) return null
  if (!['assigned', 'downloading', 'uploading'].includes(task.status)) return null
  return claims
}

async function signPayload(platform: Platform, payload: string): Promise<string> {
  const key = await hmacKey(secret(platform))
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return base64UrlEncodeBytes(new Uint8Array(signature))
}

async function hmacKey(value: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(value), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
}

function secret(platform: Platform): string {
  const value = platform.getEnv('BETTER_AUTH_SECRET') ?? platform.getEnv('DOWNLOAD_TOKEN_SECRET')
  if (!value) throw new Error('download_token_secret_missing')
  return value
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value))
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecode(value: string): string {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')
  return atob(padded)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}
