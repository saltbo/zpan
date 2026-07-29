import { AGENT_GRANTABLE_API_KEY_SCOPES } from './api-key-templates'

export const AGENT_OAUTH_CLIENT_ID = 'zpan-agent'
export const AGENT_OAUTH_CLIENT_NAME = 'ZPan Agent'
export const AGENT_OAUTH_ACCESS_TOKEN_SECONDS = 15 * 60
export const AGENT_OAUTH_REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
export const RESTISH_OAUTH_REDIRECT_URIS = ['http://localhost:8484/callback', 'http://127.0.0.1:8484/callback'] as const

export const AGENT_OAUTH_STANDARD_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const
export const AGENT_OAUTH_SCOPES = [...AGENT_OAUTH_STANDARD_SCOPES, ...AGENT_GRANTABLE_API_KEY_SCOPES] as const
