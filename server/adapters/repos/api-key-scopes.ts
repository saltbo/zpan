import { type ApiKeyScope, ApiKeyTemplate, apiKeyMetadata, parseApiKeyScope } from '@shared/api-key-templates'
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
  key: { id: string; configId: string; referenceId: string; metadata: unknown },
): Promise<{ referenceId: string; scope: ApiKeyScope } | null> {
  const existingScope = scopeForApiKey(key.configId, key.metadata)
  if (existingScope) return { referenceId: key.referenceId, scope: existingScope }

  if (key.configId === ApiKeyTemplate.WEBDAV) {
    const scope = { mode: 'user-workspaces' } as const
    await db
      .update(apikey)
      .set({ metadata: JSON.stringify(apiKeyMetadata(scope)), updatedAt: new Date() })
      .where(and(eq(apikey.id, key.id), eq(apikey.referenceId, key.referenceId)))
    return { referenceId: key.referenceId, scope }
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
      updatedAt: new Date(),
    })
    .where(and(eq(apikey.id, key.id), eq(apikey.referenceId, key.referenceId)))
  return { referenceId: ownerUserId, scope }
}

export async function normalizeLegacyApiKeysForUser(db: Database, userId: string): Promise<void> {
  const webDavKeys = await db
    .select({ id: apikey.id, metadata: apikey.metadata })
    .from(apikey)
    .where(and(eq(apikey.configId, ApiKeyTemplate.WEBDAV), eq(apikey.referenceId, userId)))
  const legacyWebDavKeyIds = webDavKeys
    .filter(({ metadata }) => scopeForApiKey(ApiKeyTemplate.WEBDAV, parseMetadata(metadata)) === null)
    .map(({ id }) => id)
  if (legacyWebDavKeyIds.length > 0) {
    await db
      .update(apikey)
      .set({
        metadata: JSON.stringify(apiKeyMetadata({ mode: 'user-workspaces' })),
        updatedAt: new Date(),
      })
      .where(inArray(apikey.id, legacyWebDavKeyIds))
  }

  const ownedOrgs = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))

  for (const { orgId } of ownedOrgs) {
    if ((await resolveOrganizationOwnerUserId(db, orgId)) !== userId) continue
    await db
      .update(apikey)
      .set({
        referenceId: userId,
        metadata: JSON.stringify(apiKeyMetadata({ mode: 'workspace', orgId })),
        updatedAt: new Date(),
      })
      .where(and(inArray(apikey.configId, WORKSPACE_TEMPLATES), eq(apikey.referenceId, orgId)))
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
