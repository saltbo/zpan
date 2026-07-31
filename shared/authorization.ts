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
  QUOTA_PURCHASE: 'quota:purchase',
  STORAGE_USAGE_READ: 'storage-usage:read',
  IMAGES_UPLOAD: 'images:upload',
  DOWNLOAD_TASKS_READ: 'download-tasks:read',
  DOWNLOAD_TASKS_CREATE: 'download-tasks:create',
  DOWNLOAD_TASKS_CANCEL: 'download-tasks:cancel',
  SITE_ANALYTICS_READ: 'site-analytics:read',
  AGENT_OAUTH_GRANTS_READ: 'agent-oauth-grants:read',
  AGENT_OAUTH_GRANTS_CREATE: 'agent-oauth-grants:create',
  AGENT_OAUTH_GRANTS_DELETE: 'agent-oauth-grants:delete',
  BACKGROUND_JOBS_READ: 'background-jobs:read',
  BACKGROUND_JOBS_CREATE: 'background-jobs:create',
  BACKGROUND_JOBS_UPDATE: 'background-jobs:update',
  DOWNLOADERS_READ: 'downloaders:read',
  DOWNLOADERS_CREATE: 'downloaders:create',
  DOWNLOADERS_UPDATE: 'downloaders:update',
  DOWNLOADERS_DELETE: 'downloaders:delete',
  IMAGE_HOSTING_CONFIG_READ: 'image-hosting-config:read',
  IMAGE_HOSTING_CONFIG_UPDATE: 'image-hosting-config:update',
  IMAGE_HOSTING_CONFIG_DELETE: 'image-hosting-config:delete',
  IMAGES_READ: 'images:read',
  IMAGES_CREATE: 'images:create',
  IMAGES_UPDATE: 'images:update',
  IMAGES_DELETE: 'images:delete',
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_UPDATE: 'notifications:update',
  ANNOUNCEMENTS_READ: 'announcements:read',
  ANNOUNCEMENTS_CREATE: 'announcements:create',
  ANNOUNCEMENTS_UPDATE: 'announcements:update',
  ANNOUNCEMENTS_DELETE: 'announcements:delete',
  AUDIT_EVENTS_READ: 'audit-events:read',
  AUTH_PROVIDERS_READ: 'auth-providers:read',
  AUTH_PROVIDERS_UPDATE: 'auth-providers:update',
  AUTH_PROVIDERS_DELETE: 'auth-providers:delete',
  BRANDING_UPDATE: 'branding:update',
  EMAIL_CONFIG_READ: 'email-config:read',
  EMAIL_CONFIG_UPDATE: 'email-config:update',
  EMAIL_CONFIG_TEST: 'email-config:test',
  IMAGE_DOMAIN_PROVIDER_READ: 'image-domain-provider:read',
  IMAGE_DOMAIN_PROVIDER_UPDATE: 'image-domain-provider:update',
  IMAGE_DOMAIN_PROVIDER_TEST: 'image-domain-provider:test',
  SITE_INVITATIONS_READ: 'site-invitations:read',
  SITE_INVITATIONS_CREATE: 'site-invitations:create',
  SITE_INVITATIONS_DELETE: 'site-invitations:delete',
  INVITE_CODES_READ: 'invite-codes:read',
  INVITE_CODES_CREATE: 'invite-codes:create',
  INVITE_CODES_DELETE: 'invite-codes:delete',
  LICENSING_READ: 'licensing:read',
  LICENSING_UPDATE: 'licensing:update',
  SITE_SETTINGS_READ: 'site-settings:read',
  SITE_SETTINGS_UPDATE: 'site-settings:update',
  STORAGES_READ: 'storages:read',
  STORAGES_CREATE: 'storages:create',
  STORAGES_UPDATE: 'storages:update',
  STORAGES_DELETE: 'storages:delete',
  SYSTEM_READ: 'system:read',
  STORE_READ: 'store:read',
  STORE_CREATE: 'store:create',
  STORE_UPDATE: 'store:update',
  TEAMS_READ: 'teams:read',
  TEAMS_CREATE: 'teams:create',
  TEAMS_UPDATE: 'teams:update',
  TEAM_INVITATIONS_READ: 'team-invitations:read',
  TEAM_INVITATIONS_CREATE: 'team-invitations:create',
  TEAM_MEMBERS_CREATE: 'team-members:create',
  TEAM_ENTITLEMENTS_READ: 'team-entitlements:read',
  TEAM_ENTITLEMENTS_CREATE: 'team-entitlements:create',
  TEAM_ENTITLEMENTS_UPDATE: 'team-entitlements:update',
  TEAM_ENTITLEMENTS_DELETE: 'team-entitlements:delete',
  USERS_READ: 'users:read',
  USERS_UPDATE: 'users:update',
  USER_ENTITLEMENTS_READ: 'user-entitlements:read',
  USER_ENTITLEMENTS_CREATE: 'user-entitlements:create',
  USER_ENTITLEMENTS_UPDATE: 'user-entitlements:update',
  USER_ENTITLEMENTS_DELETE: 'user-entitlements:delete',
} as const

export type AuthorizationScope = (typeof AuthorizationScope)[keyof typeof AuthorizationScope]

export const CANONICAL_AUTHORIZATION_SCOPES = Object.values(AuthorizationScope)

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
