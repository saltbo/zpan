import { AuthorizationScope } from './authorization'

export const AGENT_OAUTH_ACCESS_TOKEN_SECONDS = 15 * 60
export const AGENT_OAUTH_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
export const AGENT_OAUTH_ACTOR_TOKEN_SECONDS = 5 * 60
export const JWT_BEARER_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer'
export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const OAUTH_ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
export const AGENT_ACTOR_RESOURCE = 'urn:zpan:oauth:agent-actor'
export const AGENT_OAUTH_STANDARD_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const
export const AGENT_OAUTH_RESOURCE_SCOPES = [
  AuthorizationScope.OBJECTS_READ,
  AuthorizationScope.OBJECTS_CREATE,
  AuthorizationScope.OBJECTS_UPDATE,
  AuthorizationScope.OBJECTS_DELETE,
  AuthorizationScope.SHARES_READ,
  AuthorizationScope.SHARES_CREATE,
  AuthorizationScope.SHARES_DELETE,
  AuthorizationScope.QUOTA_READ,
  AuthorizationScope.QUOTA_PURCHASE,
  AuthorizationScope.STORAGE_USAGE_READ,
] as const
export const AGENT_OAUTH_SCOPES = [...AGENT_OAUTH_STANDARD_SCOPES, ...AGENT_OAUTH_RESOURCE_SCOPES] as const
export const AGENT_OAUTH_SCOPE_DESCRIPTIONS: Record<(typeof AGENT_OAUTH_RESOURCE_SCOPES)[number], string> = {
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
