export const AuthorizationScope = {
  OBJECTS_READ: 'objects:read',
  OBJECTS_CREATE: 'objects:create',
  OBJECTS_UPDATE: 'objects:update',
  OBJECTS_DELETE: 'objects:delete',
  OBJECTS_PURGE: 'objects:purge',
  SHARES_READ: 'shares:read',
  SHARES_CREATE: 'shares:create',
  SHARES_DELETE: 'shares:delete',
  QUOTA_READ: 'quota:read',
  STORAGE_USAGE_READ: 'storage-usage:read',
  IMAGES_UPLOAD: 'images:upload',
  DOWNLOAD_TASKS_READ: 'download-tasks:read',
  DOWNLOAD_TASKS_CREATE: 'download-tasks:create',
  DOWNLOAD_TASKS_CANCEL: 'download-tasks:cancel',
} as const

export type AuthorizationScope = (typeof AuthorizationScope)[keyof typeof AuthorizationScope]

export const CANONICAL_AUTHORIZATION_SCOPES = Object.values(AuthorizationScope)

export const AGENT_GRANTABLE_AUTHORIZATION_SCOPES = CANONICAL_AUTHORIZATION_SCOPES.filter(
  (scope) => scope !== AuthorizationScope.OBJECTS_PURGE,
)

const AUTHORIZATION_SCOPE_SET = new Set<string>(CANONICAL_AUTHORIZATION_SCOPES)

export type ApiKeyPermissions = Record<string, string[]>

export function isAuthorizationScope(value: string): value is AuthorizationScope {
  return AUTHORIZATION_SCOPE_SET.has(value)
}

export function authorizationScope(resource: string, action: string): AuthorizationScope | null {
  const value = `${resource}:${action}`
  return isAuthorizationScope(value) ? value : null
}

export function scopePermissions(scopes: readonly AuthorizationScope[]): ApiKeyPermissions {
  const permissions: ApiKeyPermissions = {}
  for (const scope of scopes) {
    const [resource, action] = splitAuthorizationScope(scope)
    permissions[resource] = [...(permissions[resource] ?? []), action]
  }
  return permissions
}

export function permissionScopes(permissions: ApiKeyPermissions | null | undefined): AuthorizationScope[] {
  if (!permissions) return []
  const scopes: AuthorizationScope[] = []
  for (const [resource, actions] of Object.entries(permissions)) {
    if (!Array.isArray(actions)) continue
    for (const action of actions) {
      if (typeof action !== 'string') continue
      const scope = authorizationScope(resource, action)
      if (scope) scopes.push(scope)
    }
  }
  return scopes
}

export function hasAuthorizationScope(
  permissions: ApiKeyPermissions | null | undefined,
  scope: AuthorizationScope,
): boolean {
  const [resource, action] = splitAuthorizationScope(scope)
  return permissions?.[resource]?.includes(action) ?? false
}

function splitAuthorizationScope(scope: AuthorizationScope): [string, string] {
  const index = scope.indexOf(':')
  return [scope.slice(0, index), scope.slice(index + 1)]
}
