import { AuthorizationScope, CANONICAL_AUTHORIZATION_SCOPES } from './authorization'
import { OAUTH_GRANT_SCOPE_METADATA } from './oauth-scope-metadata'

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
  (scope) => !(OAUTH_ACCOUNT_SCOPES as readonly string[]).includes(scope),
)
export const OAUTH_GRANT_SCOPES = [...OAUTH_ACCOUNT_SCOPES, ...OAUTH_RESOURCE_SCOPES] as const
export const OAUTH_SCOPES = [...OAUTH_STANDARD_SCOPES, ...OAUTH_GRANT_SCOPES] as const
export const OAUTH_SCOPE_DESCRIPTIONS: Record<(typeof OAUTH_RESOURCE_SCOPES)[number], string> = Object.fromEntries(
  OAUTH_RESOURCE_SCOPES.map((scope) => [scope, OAUTH_GRANT_SCOPE_METADATA[scope].description.en]),
) as Record<(typeof OAUTH_RESOURCE_SCOPES)[number], string>
