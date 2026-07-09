import { defaultKeyHasher } from '@better-auth/api-key'
import {
  API_KEY_TEMPLATES,
  type ApiKeyPermissions,
  ApiKeyTemplate,
  WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS,
  WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS,
  WEBDAV_API_KEY_RATE_LIMIT_WINDOW_MS,
} from '@shared/api-key-templates'
import { eq } from 'drizzle-orm'
import { apikey } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import { type ApiKeyAuth, type ApiKeyGateway, ApiKeyRateLimitError, type VerifiedApiKey } from '../../usecases/ports'

type VerifyApiKeyResult = {
  valid: boolean
  error: { message: string; code: string; details?: { tryAgainIn?: number } } | null
  key: VerifiedApiKey | null
}

export function createApiKeyGateway(): ApiKeyGateway {
  return {
    async verifyApiKey(auth, db, key, configId) {
      const resolvedConfigId = await resolveApiKeyConfigId(db, key)
      if (!resolvedConfigId) return null
      if (configId && resolvedConfigId !== configId) return null
      const result = await verify(auth, { configId: resolvedConfigId, key })
      throwIfRateLimited(result)
      if (result?.valid && result.key) return result.key
      return null
    },

    async verifyApiKeyForPermission(auth, db, key, resource, action, configId) {
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
    },

    hasApiKeyPermission(permissions: ApiKeyPermissions | null | undefined, resource, action) {
      return permissions?.[resource]?.includes(action) ?? false
    },

    isOrgApiKey(configId) {
      return configId !== ApiKeyTemplate.WEBDAV
    },
  }
}

async function verify(auth: ApiKeyAuth, body: Record<string, unknown>): Promise<VerifyApiKeyResult | null> {
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
  const rows = await db
    .select({
      id: apikey.id,
      configId: apikey.configId,
      rateLimitEnabled: apikey.rateLimitEnabled,
      rateLimitTimeWindow: apikey.rateLimitTimeWindow,
      rateLimitMax: apikey.rateLimitMax,
    })
    .from(apikey)
    .where(eq(apikey.key, hashedKey))
    .limit(1)
  const row = rows[0]
  const configId = row?.configId
  if (!configId || !API_KEY_TEMPLATES.includes(configId as ApiKeyTemplate)) return null
  if (configId === ApiKeyTemplate.WEBDAV) await upgradeLegacyWebDavRateLimit(db, row)
  return configId
}

async function upgradeLegacyWebDavRateLimit(
  db: Database,
  row: {
    id: string
    rateLimitEnabled: boolean
    rateLimitTimeWindow: number | null
    rateLimitMax: number | null
  },
) {
  if (!row.rateLimitEnabled) return
  if (row.rateLimitTimeWindow !== WEBDAV_API_KEY_RATE_LIMIT_WINDOW_MS) return
  if (row.rateLimitMax !== WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS) return

  await db
    .update(apikey)
    .set({ rateLimitMax: WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS, updatedAt: new Date() })
    .where(eq(apikey.id, row.id))
}
