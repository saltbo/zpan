import { createHash } from 'node:crypto'
import {
  AGENT_OAUTH_CLIENT_ID,
  AGENT_OAUTH_CLIENT_NAME,
  AGENT_OAUTH_SCOPES,
  RESTISH_OAUTH_REDIRECT_URIS,
} from '@shared/agent-oauth'
import { type AuthorizationScope, isAuthorizationScope } from '@shared/authorization'
import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, user as userTable } from '../../db/auth-schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { Database } from '../../platform/interface'
import type { AgentOAuthGateway, AgentOAuthGrant } from '../../usecases/ports'

export function createAgentOAuthGateway(): AgentOAuthGateway {
  return {
    async ensureSystemClient(db) {
      const now = new Date()
      const row = {
        id: AGENT_OAUTH_CLIENT_ID,
        clientId: AGENT_OAUTH_CLIENT_ID,
        clientSecret: null,
        disabled: false,
        skipConsent: false,
        enableEndSession: false,
        subjectType: 'public',
        scopes: JSON.stringify([...AGENT_OAUTH_SCOPES]),
        userId: null,
        createdAt: now,
        updatedAt: now,
        name: AGENT_OAUTH_CLIENT_NAME,
        uri: null,
        icon: null,
        contacts: null,
        tos: null,
        policy: null,
        softwareId: 'zpan-agent',
        softwareVersion: null,
        softwareStatement: null,
        redirectUris: JSON.stringify([...RESTISH_OAUTH_REDIRECT_URIS]),
        postLogoutRedirectUris: null,
        tokenEndpointAuthMethod: 'none',
        grantTypes: JSON.stringify(['authorization_code', 'refresh_token']),
        responseTypes: JSON.stringify(['code']),
        public: true,
        type: 'native',
        requirePKCE: true,
        referenceId: 'system',
        metadata: JSON.stringify({ systemManaged: true }),
      }
      await db
        .insert(oauthClient)
        .values(row)
        .onConflictDoUpdate({
          target: oauthClient.clientId,
          set: {
            disabled: false,
            scopes: row.scopes,
            updatedAt: now,
            redirectUris: row.redirectUris,
            tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
            grantTypes: row.grantTypes,
            responseTypes: row.responseTypes,
            public: true,
            type: row.type,
            requirePKCE: true,
            metadata: row.metadata,
          },
        })
    },

    async assertLiveGrant(db, input) {
      const orgId = input.orgId
      if (!orgId) throw new Error('agent_oauth_workspace_required')
      if (input.clientId !== AGENT_OAUTH_CLIENT_ID) throw new Error('agent_oauth_client_denied')
      const requestedScopes = input.scopes.filter(isAuthorizationScope)
      const consent = await findConsent(db, input.userId, input.clientId, orgId)
      if (!consent) throw new Error('agent_oauth_grant_revoked')
      const grantedScopes = parseScopes(consent.scopes).filter(isAuthorizationScope)
      if (!requestedScopes.every((scope) => grantedScopes.includes(scope))) throw new Error('agent_oauth_scope_denied')
    },

    async verifyAccessToken(db, token) {
      const rows = await db
        .select({
          userId: oauthAccessToken.userId,
          clientId: oauthAccessToken.clientId,
          orgId: oauthAccessToken.referenceId,
          scopes: oauthAccessToken.scopes,
        })
        .from(oauthAccessToken)
        .innerJoin(userTable, eq(userTable.id, oauthAccessToken.userId))
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
        .where(
          and(
            eq(oauthAccessToken.token, hashStoredToken(token)),
            eq(oauthAccessToken.clientId, AGENT_OAUTH_CLIENT_ID),
            gt(oauthAccessToken.expiresAt, new Date()),
            eq(oauthClient.disabled, false),
            eq(userTable.banned, false),
          ),
        )
        .limit(1)
      const result = rows[0]
      if (!result?.userId || !result.orgId) return null
      const scopes = parseScopes(result.scopes).filter(isAuthorizationScope)
      const consent = await findConsent(db, result.userId, result.clientId, result.orgId)
      if (!consent) return null
      const grantedScopes = parseScopes(consent.scopes).filter(isAuthorizationScope)
      return {
        grantId: consent.id,
        userId: result.userId,
        orgId: result.orgId,
        clientId: result.clientId,
        scopes: scopes.filter((scope) => grantedScopes.includes(scope)),
      }
    },

    async listGrants(db, userId) {
      const rows = await db
        .select({
          id: oauthConsent.id,
          clientId: oauthConsent.clientId,
          userId: oauthConsent.userId,
          orgId: oauthConsent.referenceId,
          scopes: oauthConsent.scopes,
          createdAt: oauthConsent.createdAt,
          lastUsedAt: oauthAccessToken.createdAt,
        })
        .from(oauthConsent)
        .leftJoin(
          oauthAccessToken,
          and(
            eq(oauthAccessToken.clientId, oauthConsent.clientId),
            eq(oauthAccessToken.userId, oauthConsent.userId),
            eq(oauthAccessToken.referenceId, oauthConsent.referenceId),
          ),
        )
        .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, AGENT_OAUTH_CLIENT_ID)))
      const grants = new Map<string, AgentOAuthGrant>()
      for (const row of rows) {
        if (!row.userId || !row.orgId) continue
        const existing = grants.get(row.id)
        const lastUsedAt = row.lastUsedAt ? toIso(row.lastUsedAt) : null
        if (existing) {
          if (lastUsedAt && (!existing.lastUsedAt || lastUsedAt > existing.lastUsedAt)) {
            existing.lastUsedAt = lastUsedAt
          }
          continue
        }
        grants.set(row.id, {
          id: row.id,
          clientId: row.clientId,
          userId: row.userId,
          orgId: row.orgId,
          scopes: parseScopes(row.scopes).filter(isAuthorizationScope),
          createdAt: toIso(row.createdAt),
          lastUsedAt,
        })
      }
      return [...grants.values()]
    },

    async revokeGrant(db, input) {
      const grants = await db
        .select({
          id: oauthConsent.id,
          clientId: oauthConsent.clientId,
          userId: oauthConsent.userId,
          referenceId: oauthConsent.referenceId,
        })
        .from(oauthConsent)
        .where(
          and(
            eq(oauthConsent.id, input.grantId),
            eq(oauthConsent.userId, input.userId),
            eq(oauthConsent.clientId, AGENT_OAUTH_CLIENT_ID),
          ),
        )
        .limit(1)
      const grant = grants[0]
      if (!grant?.userId || !grant.referenceId) return false
      const refreshRows = await db
        .select({ id: oauthRefreshToken.id })
        .from(oauthRefreshToken)
        .where(
          and(
            eq(oauthRefreshToken.clientId, grant.clientId),
            eq(oauthRefreshToken.userId, grant.userId),
            eq(oauthRefreshToken.referenceId, grant.referenceId),
            isNull(oauthRefreshToken.revoked),
          ),
        )
      const refreshIds = refreshRows.map((row) => row.id)
      await executeWriteTransaction(db, [
        db
          .delete(oauthAccessToken)
          .where(
            and(
              eq(oauthAccessToken.clientId, grant.clientId),
              eq(oauthAccessToken.userId, grant.userId),
              eq(oauthAccessToken.referenceId, grant.referenceId),
            ),
          ),
        ...(refreshIds.length > 0
          ? [db.update(oauthRefreshToken).set({ revoked: input.now }).where(inArray(oauthRefreshToken.id, refreshIds))]
          : []),
        db.delete(oauthConsent).where(eq(oauthConsent.id, grant.id)),
      ])
      return true
    },
  }
}

async function findConsent(db: Database, userId: string, clientId: string, orgId: string) {
  const rows = await db
    .select({ id: oauthConsent.id, scopes: oauthConsent.scopes })
    .from(oauthConsent)
    .innerJoin(userTable, eq(userTable.id, oauthConsent.userId))
    .where(
      and(
        eq(oauthConsent.userId, userId),
        eq(oauthConsent.clientId, clientId),
        eq(oauthConsent.referenceId, orgId),
        eq(userTable.banned, false),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

function parseScopes(value: string | string[] | null): AuthorizationScope[] {
  if (Array.isArray(value)) return value.filter(isAuthorizationScope)
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed)
    ? parsed.filter((scope): scope is AuthorizationScope => typeof scope === 'string' && isAuthorizationScope(scope))
    : []
}

function toIso(value: Date | number | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_agent_oauth_date')
  return date.toISOString()
}

function hashStoredToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}
