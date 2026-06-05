import { defaultKeyHasher } from '@better-auth/api-key'
import { eq } from 'drizzle-orm'
import { API_KEY_TEMPLATES, type ApiKeyPermissions, ApiKeyTemplate } from '../../shared/api-key-templates'
import type { Auth } from '../auth'
import { apikey } from '../db/auth-schema'
import type { Database } from '../platform/interface'

export type VerifiedApiKey = {
  id: string
  configId: string
  referenceId: string
  permissions: ApiKeyPermissions | null
}

type VerifyApiKeyResult = {
  valid: boolean
  error: { message: string; code: string; details?: { tryAgainIn?: number } } | null
  key: VerifiedApiKey | null
}

export class ApiKeyRateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ApiKeyRateLimitError'
  }
}

export async function verifyApiKeyForPermission(
  auth: Auth,
  db: Database,
  key: string,
  resource: string,
  action: string,
  configId?: string,
): Promise<VerifiedApiKey | null> {
  const resolvedConfigId = await resolveApiKeyConfigId(db, key)
  if (!resolvedConfigId) return null
  if (configId && resolvedConfigId !== configId) return null
  const result = await verify(auth, {
    configId: resolvedConfigId,
    key,
    permissions: { [resource]: [action] },
  })
  throwIfRateLimited(result)
  if (result?.valid && result.key) return result.key
  return null
}

export async function verifyApiKey(
  auth: Auth,
  db: Database,
  key: string,
  configId?: string,
): Promise<VerifiedApiKey | null> {
  const resolvedConfigId = await resolveApiKeyConfigId(db, key)
  if (!resolvedConfigId) return null
  if (configId && resolvedConfigId !== configId) return null
  const result = await verify(auth, { configId: resolvedConfigId, key })
  throwIfRateLimited(result)
  if (result?.valid && result.key) return result.key
  return null
}

export function hasApiKeyPermission(
  permissions: ApiKeyPermissions | null | undefined,
  resource: string,
  action: string,
) {
  return permissions?.[resource]?.includes(action) ?? false
}

export function isOrgApiKey(configId: string) {
  return configId !== ApiKeyTemplate.WEBDAV
}

async function verify(auth: Auth, body: Record<string, unknown>): Promise<VerifyApiKeyResult | null> {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: better-auth plugin API is not fully typed
    return (await (auth.api as any).verifyApiKey({ body })) as VerifyApiKeyResult
  } catch {
    return null
  }
}

function throwIfRateLimited(result: VerifyApiKeyResult | null) {
  if (result?.error?.code !== 'RATE_LIMITED') return
  throw new ApiKeyRateLimitError(result.error.message, result.error.details?.tryAgainIn)
}

async function resolveApiKeyConfigId(db: Database, rawKey: string): Promise<string | null> {
  const hashedKey = await defaultKeyHasher(rawKey)
  const rows = await db.select({ configId: apikey.configId }).from(apikey).where(eq(apikey.key, hashedKey)).limit(1)
  const configId = rows[0]?.configId
  if (!configId || !API_KEY_TEMPLATES.includes(configId as ApiKeyTemplate)) return null
  return configId
}
