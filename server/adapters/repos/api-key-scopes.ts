import {
  type ApiKeyPermissions,
  type ApiKeyScope,
  ApiKeyTemplate,
  apiKeyMetadata,
  canonicalizeApiKeyPermissions,
  parseApiKeyScope,
  serializeApiKeyPermissions,
} from '@shared/api-key-templates'
import { and, eq, inArray } from 'drizzle-orm'
import { apikey, member } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'
import { resolveOrganizationOwnerUserId } from './organization-owner'

const WORKSPACE_TEMPLATES = [ApiKeyTemplate.IHOST, ApiKeyTemplate.REMOTE_DOWNLOAD]

export function scopeForApiKey(configId: string, metadata: unknown): ApiKeyScope | null {
  const scope = parseApiKeyScope(metadata)
  if (configId === ApiKeyTemplate.WEBDAV) {
    return scope?.mode === 'user-workspaces' ? scope : null
  }
  if (WORKSPACE_TEMPLATES.includes(configId as (typeof WORKSPACE_TEMPLATES)[number])) {
    return scope?.mode === 'workspace' ? scope : null
  }
  return null
}

export async function normalizeLegacyApiKey(
  db: Database,
  key: {
    id: string
    configId: string
    referenceId: string
    metadata: unknown
    permissions: ApiKeyPermissions | null
  },
): Promise<{ referenceId: string; scope: ApiKeyScope; permissions: ApiKeyPermissions | null } | null> {
  const permissions = key.permissions ? canonicalizeApiKeyPermissions(key.permissions) : null
  const permissionsChanged =
    key.permissions !== null &&
    permissions !== null &&
    serializeApiKeyPermissions(key.permissions) !== serializeApiKeyPermissions(permissions)
  const existingScope = scopeForApiKey(key.configId, key.metadata)
  if (existingScope) {
    if (permissionsChanged) {
      await db
        .update(apikey)
        .set({ permissions: serializeApiKeyPermissions(permissions), updatedAt: new Date() })
        .where(eq(apikey.id, key.id))
    }
    return { referenceId: key.referenceId, scope: existingScope, permissions }
  }

  if (key.configId === ApiKeyTemplate.WEBDAV) {
    const scope = { mode: 'user-workspaces' } as const
    await db
      .update(apikey)
      .set({
        metadata: JSON.stringify(apiKeyMetadata(scope)),
        ...(permissions ? { permissions: serializeApiKeyPermissions(permissions) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(apikey.id, key.id))
    return { referenceId: key.referenceId, scope, permissions }
  }

  if (!WORKSPACE_TEMPLATES.includes(key.configId as (typeof WORKSPACE_TEMPLATES)[number])) return null

  let ownerUserId: string
  try {
    ownerUserId = await resolveOrganizationOwnerUserId(db, key.referenceId)
  } catch {
    await db.update(apikey).set({ enabled: false, updatedAt: new Date() }).where(eq(apikey.id, key.id))
    return null
  }

  const scope = { mode: 'workspace', orgId: key.referenceId } as const
  await db
    .update(apikey)
    .set({
      referenceId: ownerUserId,
      metadata: JSON.stringify(apiKeyMetadata(scope)),
      ...(permissions ? { permissions: serializeApiKeyPermissions(permissions) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(apikey.id, key.id))
  return { referenceId: ownerUserId, scope, permissions }
}

export async function normalizeLegacyApiKeysForUser(db: Database, userId: string): Promise<void> {
  const webDavKeys = await db
    .select({
      id: apikey.id,
      configId: apikey.configId,
      referenceId: apikey.referenceId,
      metadata: apikey.metadata,
      permissions: apikey.permissions,
    })
    .from(apikey)
    .where(and(eq(apikey.configId, ApiKeyTemplate.WEBDAV), eq(apikey.referenceId, userId)))
  for (const key of webDavKeys) await normalizeStoredApiKey(db, key)

  const ownedOrgs = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
  for (const { orgId } of ownedOrgs) {
    const workspaceKeys = await db
      .select({
        id: apikey.id,
        configId: apikey.configId,
        referenceId: apikey.referenceId,
        metadata: apikey.metadata,
        permissions: apikey.permissions,
      })
      .from(apikey)
      .where(and(inArray(apikey.configId, WORKSPACE_TEMPLATES), eq(apikey.referenceId, orgId)))
    for (const key of workspaceKeys) await normalizeStoredApiKey(db, key)
  }
}

export async function deleteApiKeysScopedToOrganization(db: Database, orgId: string): Promise<void> {
  const rows = await db
    .select({ id: apikey.id, configId: apikey.configId, referenceId: apikey.referenceId, metadata: apikey.metadata })
    .from(apikey)
    .where(inArray(apikey.configId, WORKSPACE_TEMPLATES))

  const ids = rows
    .filter((row) => {
      const scope = scopeForApiKey(row.configId, parseMetadata(row.metadata))
      return scope?.mode === 'workspace' ? scope.orgId === orgId : row.referenceId === orgId
    })
    .map((row) => row.id)
  if (ids.length > 0) await db.delete(apikey).where(inArray(apikey.id, ids))
}

function parseMetadata(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parsePermissions(value: string | null): ApiKeyPermissions | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ApiKeyPermissions) : null
  } catch {
    return null
  }
}

async function normalizeStoredApiKey(
  db: Database,
  key: { id: string; configId: string; referenceId: string; metadata: string | null; permissions: string | null },
) {
  await normalizeLegacyApiKey(db, {
    ...key,
    metadata: parseMetadata(key.metadata),
    permissions: parsePermissions(key.permissions),
  })
}
