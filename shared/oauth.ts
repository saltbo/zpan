import { AuthorizationScope, CANONICAL_AUTHORIZATION_SCOPES } from './authorization'

export const OAUTH_ACCESS_TOKEN_SECONDS = 15 * 60
export const OAUTH_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
export const OAUTH_ACTOR_TOKEN_SECONDS = 5 * 60
export const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const OAUTH_ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
export const AGENT_ACTOR_RESOURCE = 'urn:zpan:oauth:agent-actor'
export const WORKSPACE_AUTHORIZATION_DETAIL_TYPE = 'https://zpan.space/authorization-details/workspace'
export const OAUTH_STANDARD_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const
export const OAUTH_ACCOUNT_SCOPES = [AuthorizationScope.WORKSPACES_DISCOVER] as const
export const OAUTH_RESOURCE_SCOPES = CANONICAL_AUTHORIZATION_SCOPES.filter(
  (scope) => scope !== AuthorizationScope.OBJECTS_PURGE && !(OAUTH_ACCOUNT_SCOPES as readonly string[]).includes(scope),
)
export const OAUTH_GRANT_SCOPES = [...OAUTH_ACCOUNT_SCOPES, ...OAUTH_RESOURCE_SCOPES] as const
export const OAUTH_SCOPES = [...OAUTH_STANDARD_SCOPES, ...OAUTH_GRANT_SCOPES] as const
const EXPLICIT_SCOPE_DESCRIPTIONS: Partial<Record<AuthorizationScope, string>> = {
  [AuthorizationScope.OBJECTS_READ]: 'List, inspect, and download objects',
  [AuthorizationScope.OBJECTS_CREATE]: 'Create folders and upload objects',
  [AuthorizationScope.OBJECTS_UPDATE]: 'Rename, move, and copy objects',
  [AuthorizationScope.OBJECTS_DELETE]: 'Soft-delete objects',
  [AuthorizationScope.SHARES_READ]: 'List and inspect shares',
  [AuthorizationScope.SHARES_CREATE]: 'Create public shares',
  [AuthorizationScope.SHARES_DELETE]: 'Revoke shares',
  [AuthorizationScope.QUOTA_READ]: 'Inspect workspace quota',
  [AuthorizationScope.QUOTA_PURCHASE]: 'Purchase workspace storage capacity',
  [AuthorizationScope.STORAGE_USAGE_READ]: 'Inspect workspace storage usage',
}
export const OAUTH_SCOPE_DESCRIPTIONS: Record<(typeof OAUTH_RESOURCE_SCOPES)[number], string> = Object.fromEntries(
  OAUTH_RESOURCE_SCOPES.map((scope) => [scope, describeScope(scope)]),
) as Record<(typeof OAUTH_RESOURCE_SCOPES)[number], string>

function describeScope(scope: string): string {
  if (scope in EXPLICIT_SCOPE_DESCRIPTIONS) return EXPLICIT_SCOPE_DESCRIPTIONS[scope as AuthorizationScope]!
  const [resource, action] = scope.split(':')
  return `${capitalize(action)} ${resource.replaceAll('-', ' ')}`
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1)
}
