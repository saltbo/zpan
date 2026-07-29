import { z } from 'zod'
import {
  AGENT_OAUTH_ACCESS_TOKEN_SECONDS,
  AGENT_OAUTH_CLIENT_NAME,
  AGENT_OAUTH_REFRESH_TOKEN_SECONDS,
} from '../agent-oauth'
import { agentGrantableScopeSchema } from './agent-api-keys'

export const agentOAuthGrantStatusSchema = z.enum(['active'])
export type AgentOAuthGrantStatus = z.infer<typeof agentOAuthGrantStatusSchema>

export const agentOAuthGrantSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().default(AGENT_OAUTH_CLIENT_NAME),
  userId: z.string(),
  orgId: z.string(),
  workspaceName: z.string().nullable(),
  scopes: z.array(agentGrantableScopeSchema),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  status: agentOAuthGrantStatusSchema,
})
export type AgentOAuthGrant = z.infer<typeof agentOAuthGrantSchema>

export const agentOAuthGrantListSchema = z.object({ items: z.array(agentOAuthGrantSchema) })
export type AgentOAuthGrantList = z.infer<typeof agentOAuthGrantListSchema>

export const agentOAuthConsentContextSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  instanceOrigin: z.string(),
  workspace: z.object({
    id: z.string(),
    name: z.string().nullable(),
  }),
  scopes: z.array(agentGrantableScopeSchema),
  standardScopes: z.array(z.string()),
  redirectUri: z.string(),
  grantLifetime: z.object({
    accessTokenSeconds: z.number().int().default(AGENT_OAUTH_ACCESS_TOKEN_SECONDS),
    refreshTokenSeconds: z.number().int().default(AGENT_OAUTH_REFRESH_TOKEN_SECONDS),
  }),
})
export type AgentOAuthConsentContext = z.infer<typeof agentOAuthConsentContextSchema>

export const agentOAuthConsentContextRequestSchema = z.object({
  oauthQuery: z.string().min(1),
})
export type AgentOAuthConsentContextRequest = z.infer<typeof agentOAuthConsentContextRequestSchema>

export const agentOAuthConsentSubmitSchema = z.object({
  accept: z.boolean(),
  oauthQuery: z.string().min(1),
})
export type AgentOAuthConsentSubmit = z.infer<typeof agentOAuthConsentSubmitSchema>

export const agentOAuthConsentResultSchema = z.object({
  url: z.string(),
})
export type AgentOAuthConsentResult = z.infer<typeof agentOAuthConsentResultSchema>

export function agentOAuthGrantDTO(input: Omit<AgentOAuthGrant, 'clientName' | 'status'>): AgentOAuthGrant {
  return {
    ...input,
    clientName: AGENT_OAUTH_CLIENT_NAME,
    status: 'active',
  }
}
