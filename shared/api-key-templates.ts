import { type ApiKeyPermissions, AuthorizationScope, scopePermissions } from './authorization'

export type { ApiKeyPermissions } from './authorization'

export const ApiKeyTemplate = {
  IHOST: 'ihost',
  WEBDAV: 'webdav',
  REMOTE_DOWNLOAD: 'remote-download',
} as const

export type ApiKeyTemplate = (typeof ApiKeyTemplate)[keyof typeof ApiKeyTemplate]

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
export const WEBDAV_API_KEY_RATE_LIMIT_MAX_REQUESTS = 3600
export const WEBDAV_RATE_LIMITER_BINDING = 'WEBDAV_RATE_LIMITER'

export const IHOST_API_KEY_PERMISSIONS = scopePermissions([AuthorizationScope.IMAGES_UPLOAD])
export const WEBDAV_API_KEY_PERMISSIONS = scopePermissions([
  AuthorizationScope.OBJECTS_READ,
  AuthorizationScope.OBJECTS_CREATE,
  AuthorizationScope.OBJECTS_UPDATE,
  AuthorizationScope.OBJECTS_DELETE,
  AuthorizationScope.OBJECTS_MOVE,
])
export const REMOTE_DOWNLOAD_API_KEY_PERMISSIONS = {
  ...scopePermissions([
    AuthorizationScope.DOWNLOAD_TASKS_READ,
    AuthorizationScope.DOWNLOAD_TASKS_CREATE,
    AuthorizationScope.DOWNLOAD_TASKS_CANCEL,
  ]),
} satisfies ApiKeyPermissions

export const API_KEY_TEMPLATE_PERMISSIONS = {
  [ApiKeyTemplate.IHOST]: IHOST_API_KEY_PERMISSIONS,
  [ApiKeyTemplate.WEBDAV]: WEBDAV_API_KEY_PERMISSIONS,
  [ApiKeyTemplate.REMOTE_DOWNLOAD]: REMOTE_DOWNLOAD_API_KEY_PERMISSIONS,
} satisfies Record<ApiKeyTemplate, ApiKeyPermissions>

export const API_KEY_TEMPLATES = Object.values(ApiKeyTemplate)
