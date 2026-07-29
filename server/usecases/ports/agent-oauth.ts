import type { AuthorizationScope } from '@shared/authorization'
import type { Database } from '../../platform/interface'

export interface VerifiedAgentOAuthToken {
  grantId: string
  userId: string
  orgId: string
  clientId: string
  scopes: AuthorizationScope[]
}

export interface AgentOAuthGrant {
  id: string
  clientId: string
  userId: string
  orgId: string
  scopes: AuthorizationScope[]
  createdAt: string
  lastUsedAt: string | null
}

export interface AgentOAuthGateway {
  ensureSystemClient(db: Database): Promise<void>
  assertLiveGrant(
    db: Database,
    input: { userId: string; clientId: string; orgId?: string; scopes: readonly string[] },
  ): Promise<void>
  verifyAccessToken(db: Database, token: string): Promise<VerifiedAgentOAuthToken | null>
  listGrants(db: Database, userId: string): Promise<AgentOAuthGrant[]>
  recordGrantUse(db: Database, input: { grantId: string; userId: string; orgId: string; now: Date }): Promise<void>
  revokeGrant(db: Database, input: { userId: string; grantId: string; now: Date }): Promise<boolean>
}
