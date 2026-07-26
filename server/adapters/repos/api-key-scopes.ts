import { type ApiKeyScope, ApiKeyTemplate, parseApiKeyScope } from '@shared/api-key-templates'
import { inArray } from 'drizzle-orm'
import { apikey } from '../../db/auth-schema'
import type { Database } from '../../platform/interface'

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
