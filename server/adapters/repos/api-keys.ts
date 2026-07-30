import { defaultKeyHasher } from '@better-auth/api-key'
import {
  API_KEY_TEMPLATES,
  type ApiKeyPermissions,
  type ApiKeyTemplate as ApiKeyTemplateId,
} from '@shared/api-key-templates'
import { authorizationScope, hasAuthorizationScope } from '@shared/authorization'
import { eq } from 'drizzle-orm'
import { apikey } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import { type ApiKeyAuth, type ApiKeyGateway, ApiKeyRateLimitError, type VerifiedApiKey } from '../../usecases/ports'
import { scopeForApiKey } from './api-key-scopes'

type VerifyApiKeyResult = {
  valid: boolean
  error: { message: string; code: string; details?: { tryAgainIn?: number } } | null
  key: {
    id: string
    configId: string
    referenceId: string
    metadata: unknown
    permissions: ApiKeyPermissions | null
  } | null
}

export function createApiKeyGateway(): ApiKeyGateway {
  return {
    async verifyApiKey(auth, db, key, configId) {
      const resolvedConfigId = configId ?? (await resolveApiKeyConfigId(db, key))
      if (!resolvedConfigId) return null
      const result = await verify(auth, { configId: resolvedConfigId, key })
      throwIfRateLimited(result)
      if (result?.valid && result.key) return normalizeVerifiedApiKey(result.key)
      return null
    },

    async verifyApiKeyForPermission(auth, db, key, resource, action, configId) {
      const scope = authorizationScope(resource, action)
      if (!scope) return null
      const resolvedConfigId = configId ?? (await resolveApiKeyConfigId(db, key))
      if (!resolvedConfigId) return null
      const result = await verify(auth, {
        configId: resolvedConfigId,
        key,
        permissions: { [resource]: [action] },
      })
      throwIfRateLimited(result)
      if (result?.valid && result.key) return normalizeVerifiedApiKey(result.key)
      return null
    },

    hasApiKeyPermission(permissions: ApiKeyPermissions | null | undefined, resource, action) {
      const scope = authorizationScope(resource, action)
      return scope ? hasAuthorizationScope(permissions, scope) : false
    },

    hasApiKeyScope(permissions: ApiKeyPermissions | null | undefined, scope) {
      return hasAuthorizationScope(permissions, scope)
    },
  }
}

async function normalizeVerifiedApiKey(key: NonNullable<VerifyApiKeyResult['key']>): Promise<VerifiedApiKey | null> {
  const scope = scopeForApiKey(key.configId, key.metadata)
  if (!scope) return null
  return {
    id: key.id,
    configId: key.configId,
    referenceId: key.referenceId,
    scope,
    permissions: key.permissions,
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

async function resolveApiKeyConfigId(db: Database, rawKey: string): Promise<ApiKeyTemplateId | null> {
  const hashedKey = await defaultKeyHasher(rawKey)
  const rows = await db.select({ configId: apikey.configId }).from(apikey).where(eq(apikey.key, hashedKey)).limit(1)
  const configId = rows[0]?.configId
  return configId && API_KEY_TEMPLATES.includes(configId as ApiKeyTemplateId) ? (configId as ApiKeyTemplateId) : null
}
