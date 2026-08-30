import { z } from 'zod'
import { OAUTH_GRANT_SCOPES, OAUTH_RESOURCE_SCOPES } from '../oauth'

export const oauthResourceScopeSchema = z.enum(OAUTH_RESOURCE_SCOPES)
export type OAuthResourceScope = z.infer<typeof oauthResourceScopeSchema>
export const oauthGrantScopeSchema = z.enum(OAUTH_GRANT_SCOPES)
export type OAuthGrantScope = z.infer<typeof oauthGrantScopeSchema>
