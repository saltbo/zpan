import type { AuthorizationScope } from '@shared/authorization'
import type { Database } from '../../platform/interface'

export interface AgentOAuthGrant {
  id: string
  clientId: string
  clientName: string
  userId: string
  orgId: string
  scopes: AuthorizationScope[]
  createdAt: string
  lastUsedAt: string | null
}

export interface AgentOAuthClient {
  clientId: string
  clientName: string
  disabled: boolean
  redirectUris: string[]
  responseTypes: string[]
  scopes: string[]
}

export interface RegisteredOAuthApplication {
  clientId: string
  name: string
  uri: string | null
  redirectUris: string[]
  grantTypes: string[]
  scopes: string[]
  disabled: boolean
  createdAt: string
}

export interface AgentOAuthGateway {
  findClient(db: Database, clientId: string): Promise<AgentOAuthClient | null>
  listRegisteredApplications(db: Database): Promise<RegisteredOAuthApplication[]>
  revokeJwtAccessToken(db: Database, token: string): Promise<void>
  isJwtAccessTokenRevoked(db: Database, tokenId: string): Promise<boolean>
  listGrants(db: Database, userId: string): Promise<AgentOAuthGrant[]>
  revokeGrant(db: Database, input: { userId: string; grantId: string; now: Date }): Promise<boolean>
}
