import type { AuthorizationScope } from '@shared/authorization'
import type { Database } from '../../platform/interface'

export interface OAuthGrant {
  id: string
  clientId: string
  clientName: string
  userId: string
  orgId: string
  scopes: AuthorizationScope[]
  createdAt: string
  lastUsedAt: string | null
}

export interface OAuthClient {
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

export interface OAuthGateway {
  findClient(db: Database, clientId: string): Promise<OAuthClient | null>
  listRegisteredApplications(db: Database): Promise<RegisteredOAuthApplication[]>
  revokeJwtAccessToken(db: Database, token: string): Promise<void>
  isJwtAccessTokenRevoked(db: Database, tokenId: string): Promise<boolean>
  listGrants(db: Database, userId: string): Promise<OAuthGrant[]>
  revokeGrant(db: Database, input: { userId: string; grantId: string; now: Date }): Promise<boolean>
}
