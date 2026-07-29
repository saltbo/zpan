import { defaultKeyHasher } from '@better-auth/api-key'
import {
  AGENT_GRANTABLE_API_KEY_SCOPES,
  API_KEY_TEMPLATES,
  type ApiKeyPermissions,
  ApiKeyTemplate,
  type ApiKeyTemplate as ApiKeyTemplateId,
  apiKeyMetadata,
} from '@shared/api-key-templates'
import {
  type AuthorizationScope,
  authorizationScope,
  hasAuthorizationScope,
  permissionScopes,
  scopePermissions,
} from '@shared/authorization'
import type { AgentApiKey, AgentGrantableScope } from '@shared/schemas'
import { and, desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { apikey, organization } from '../../db/auth-schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import { type ApiKeyAuth, type ApiKeyGateway, ApiKeyRateLimitError, type VerifiedApiKey } from '../../usecases/ports'
import { scopeForApiKey } from './api-key-scopes'

const AGENT_API_KEY_PREFIX = 'zpan_agent_'
const AGENT_GRANTABLE_SCOPE_SET = new Set<AuthorizationScope>(AGENT_GRANTABLE_API_KEY_SCOPES)

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

    async listAgentApiKeys(db, userId, orgId, now) {
      const rows = await listAgentRows(db, userId, orgId)
      return rows.map((row) => toAgentApiKeyDTO(row, now))
    },

    async getAgentApiKey(db, userId, orgId, keyId, now) {
      const row = await getAgentRow(db, userId, orgId, keyId)
      return row ? toAgentApiKeyDTO(row, now) : null
    },

    async issueAgentApiKey(db, input) {
      const now = new Date()
      const id = crypto.randomUUID()
      const key = `${AGENT_API_KEY_PREFIX}${nanoid(48)}`
      const hashedKey = await defaultKeyHasher(key)
      const insert = db.insert(apikey).values({
        id,
        configId: ApiKeyTemplate.AGENT,
        name: input.name,
        start: key.slice(0, AGENT_API_KEY_PREFIX.length + 6),
        referenceId: input.userId,
        prefix: AGENT_API_KEY_PREFIX,
        key: hashedKey,
        enabled: true,
        rateLimitEnabled: true,
        rateLimitTimeWindow: 60_000,
        rateLimitMax: 600,
        requestCount: 0,
        expiresAt: input.expiresAt,
        createdAt: now,
        updatedAt: now,
        permissions: JSON.stringify(scopePermissions(input.scopes)),
        metadata: JSON.stringify(apiKeyMetadata({ mode: 'workspace', orgId: input.orgId })),
      })
      const revoke = input.revokeKeyId
        ? db.update(apikey).set({ enabled: false, updatedAt: now }).where(eq(apikey.id, input.revokeKeyId))
        : null
      await executeWriteTransaction(db, revoke ? [insert, revoke] : [insert])
      const row = await getAgentRow(db, input.userId, input.orgId, id)
      if (!row) throw new Error('agent_api_key_create_failed')
      return { key, item: toAgentApiKeyDTO(row, now) }
    },

    async revokeAgentApiKey(db, keyId) {
      await db.update(apikey).set({ enabled: false, updatedAt: new Date() }).where(eq(apikey.id, keyId))
    },
  }
}

type AgentApiKeyRow = {
  id: string
  name: string | null
  permissions: string | null
  metadata: string | null
  enabled: boolean
  createdAt: Date | number | string
  expiresAt: Date | number | string | null
  lastRequest: Date | number | string | null
  workspaceName: string | null
}

async function listAgentRows(db: Database, userId: string, orgId: string): Promise<AgentApiKeyRow[]> {
  const rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      permissions: apikey.permissions,
      metadata: apikey.metadata,
      enabled: apikey.enabled,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
      workspaceName: organization.name,
    })
    .from(apikey)
    .leftJoin(organization, eq(organization.id, orgId))
    .where(and(eq(apikey.configId, ApiKeyTemplate.AGENT), eq(apikey.referenceId, userId)))
    .orderBy(desc(apikey.createdAt))
  return rows.filter((row) => parseWorkspaceMetadata(row.metadata)?.orgId === orgId)
}

async function getAgentRow(db: Database, userId: string, orgId: string, keyId: string): Promise<AgentApiKeyRow | null> {
  const rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      permissions: apikey.permissions,
      metadata: apikey.metadata,
      enabled: apikey.enabled,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
      workspaceName: organization.name,
    })
    .from(apikey)
    .leftJoin(organization, eq(organization.id, orgId))
    .where(and(eq(apikey.id, keyId), eq(apikey.configId, ApiKeyTemplate.AGENT), eq(apikey.referenceId, userId)))
    .limit(1)
  const row = rows[0]
  return row && parseWorkspaceMetadata(row.metadata)?.orgId === orgId ? row : null
}

function toAgentApiKeyDTO(row: AgentApiKeyRow, now: Date): AgentApiKey {
  const scope = parseWorkspaceMetadata(row.metadata)
  if (!scope) throw new Error('agent_api_key_workspace_scope_missing')
  const expiresAt = requireDate(row.expiresAt, 'agent_api_key_expiry_missing')
  return {
    id: row.id,
    name: row.name ?? row.id,
    orgId: scope.orgId,
    workspaceName: row.workspaceName,
    scopes: parseStoredScopes(row.permissions),
    createdAt: toIso(row.createdAt),
    expiresAt: expiresAt.toISOString(),
    lastUsedAt: row.lastRequest ? toIso(row.lastRequest) : null,
    status: !row.enabled ? 'revoked' : expiresAt <= now ? 'expired' : 'active',
  }
}

function parseWorkspaceMetadata(value: string | null): { orgId: string } | null {
  if (!value) return null
  const parsed = JSON.parse(value) as { scope?: { mode?: unknown; orgId?: unknown } }
  return parsed.scope?.mode === 'workspace' && typeof parsed.scope.orgId === 'string'
    ? { orgId: parsed.scope.orgId }
    : null
}

function parseStoredScopes(value: string | null): AgentGrantableScope[] {
  if (!value) return []
  const permissions = JSON.parse(value) as ApiKeyPermissions
  return permissionScopes(permissions).filter((scope): scope is AgentGrantableScope =>
    AGENT_GRANTABLE_SCOPE_SET.has(scope),
  )
}

function requireDate(value: Date | number | string | null, message: string): Date {
  if (value === null) throw new Error(message)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(message)
  return date
}

function toIso(value: Date | number | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_agent_api_key_date')
  return date.toISOString()
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
