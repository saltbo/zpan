export const ApiKeyTemplate = {
  IHOST: 'ihost',
  WEBDAV: 'webdav',
  REMOTE_DOWNLOAD: 'remote-download',
} as const

export type ApiKeyTemplate = (typeof ApiKeyTemplate)[keyof typeof ApiKeyTemplate]

export type ApiKeyPermissions = Record<string, string[]>

export type ApiKeyScope =
  | { mode: 'user-workspaces' }
  | {
      mode: 'workspace'
      orgId: string
    }

export interface ApiKeyMetadata {
  scope: ApiKeyScope
}

export function apiKeyMetadata(scope: ApiKeyScope): ApiKeyMetadata {
  return { scope }
}

export function parseApiKeyScope(metadata: unknown): ApiKeyScope | null {
  if (!metadata || typeof metadata !== 'object') return null
  const scope = (metadata as { scope?: unknown }).scope
  if (!scope || typeof scope !== 'object') return null
  const candidate = scope as { mode?: unknown; orgId?: unknown }
  if (candidate.mode === 'user-workspaces') return { mode: 'user-workspaces' }
  if (candidate.mode === 'workspace' && typeof candidate.orgId === 'string' && candidate.orgId) {
    return { mode: 'workspace', orgId: candidate.orgId }
  }
  return null
}

export const WEBDAV_API_KEY_RATE_LIMIT_WINDOW_MS = 60_000
export const WEBDAV_API_KEY_LEGACY_RATE_LIMIT_MAX_REQUESTS = 120
export const WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS = 3600

export const IHOST_API_KEY_PERMISSIONS = { ihost: ['upload'] } satisfies ApiKeyPermissions
export const WEBDAV_API_KEY_PERMISSIONS = { webdav: ['read', 'write'] } satisfies ApiKeyPermissions
export const REMOTE_DOWNLOAD_API_KEY_PERMISSIONS = {
  remoteDownload: ['read', 'create', 'cancel'],
} satisfies ApiKeyPermissions

export const API_KEY_TEMPLATE_PERMISSIONS = {
  [ApiKeyTemplate.IHOST]: IHOST_API_KEY_PERMISSIONS,
  [ApiKeyTemplate.WEBDAV]: WEBDAV_API_KEY_PERMISSIONS,
  [ApiKeyTemplate.REMOTE_DOWNLOAD]: REMOTE_DOWNLOAD_API_KEY_PERMISSIONS,
} satisfies Record<ApiKeyTemplate, ApiKeyPermissions>

export const API_KEY_TEMPLATES = Object.values(ApiKeyTemplate)
