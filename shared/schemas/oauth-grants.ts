import { z } from 'zod'
import { OAUTH_ACCESS_TOKEN_SECONDS, OAUTH_REFRESH_TOKEN_SECONDS } from '../oauth'
import { opaqueIdSchema } from './id'
import { oauthGrantScopeSchema } from './oauth-resource'

export const oauthGrantStatusSchema = z.enum(['active'])
export type OAuthGrantStatus = z.infer<typeof oauthGrantStatusSchema>

export const oauthGrantSchema = z.object({
  id: opaqueIdSchema,
  clientId: z.string(),
  clientName: z.string(),
  userId: opaqueIdSchema,
  workspaces: z.array(z.object({ id: opaqueIdSchema, name: z.string().nullable() })).min(1),
  scopes: z.array(oauthGrantScopeSchema),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  status: oauthGrantStatusSchema,
})
export type OAuthGrant = z.infer<typeof oauthGrantSchema>

export const oauthGrantListSchema = z.object({ items: z.array(oauthGrantSchema) })
export type OAuthGrantList = z.infer<typeof oauthGrantListSchema>

export const oauthConsentContextSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  clientOrigin: z.string(),
  workspaces: z
    .array(
      z.object({
        id: opaqueIdSchema,
        name: z.string().nullable(),
      }),
    )
    .min(1),
  requestedWorkspaceIds: z.array(opaqueIdSchema),
  scopes: z.array(oauthGrantScopeSchema),
  standardScopes: z.array(z.string()),
  redirectUri: z.string(),
  grantLifetime: z.object({
    accessTokenSeconds: z.number().int().default(OAUTH_ACCESS_TOKEN_SECONDS),
    refreshTokenSeconds: z.number().int().default(OAUTH_REFRESH_TOKEN_SECONDS),
  }),
})
export type OAuthConsentContext = z.infer<typeof oauthConsentContextSchema>

export const oauthConsentContextRequestSchema = z.object({
  oauthQuery: z.string().min(1),
})
export type OAuthConsentContextRequest = z.infer<typeof oauthConsentContextRequestSchema>

export const oauthConsentSubmitSchema = z.object({
  accept: z.boolean(),
  oauthQuery: z.string().min(1),
  workspaceIds: z.array(opaqueIdSchema),
})
export type OAuthConsentSubmit = z.infer<typeof oauthConsentSubmitSchema>

export const oauthConsentResultSchema = z.object({
  url: z.string(),
})
export type OAuthConsentResult = z.infer<typeof oauthConsentResultSchema>

export function oauthGrantDTO(input: Omit<OAuthGrant, 'status'>): OAuthGrant {
  return {
    ...input,
    status: 'active',
  }
}
