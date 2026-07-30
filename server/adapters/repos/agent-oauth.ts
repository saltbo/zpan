import { type AuthorizationScope, isAuthorizationScope } from '@shared/authorization'
import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthJwtRevocation,
  oauthRefreshToken,
} from '../../db/auth-schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { AgentOAuthClient, AgentOAuthGateway } from '../../usecases/ports'

export function createAgentOAuthGateway(): AgentOAuthGateway {
  return {
    async findClient(db, clientId) {
      const [row] = await db
        .select({
          clientId: oauthClient.clientId,
          name: oauthClient.name,
          disabled: oauthClient.disabled,
          redirectUris: oauthClient.redirectUris,
          responseTypes: oauthClient.responseTypes,
          scopes: oauthClient.scopes,
          referenceId: oauthClient.referenceId,
        })
        .from(oauthClient)
        .where(eq(oauthClient.clientId, clientId))
        .limit(1)
      if (!row || row.referenceId === 'system') return null
      return {
        clientId: row.clientId,
        clientName: row.name || row.clientId,
        disabled: row.disabled === true,
        redirectUris: parseStringArray(row.redirectUris),
        responseTypes: parseStringArray(row.responseTypes),
        scopes: parseStringArray(row.scopes),
      } satisfies AgentOAuthClient
    },

    async listRegisteredApplications(db) {
      const rows = await db
        .select({
          clientId: oauthClient.clientId,
          name: oauthClient.name,
          uri: oauthClient.uri,
          redirectUris: oauthClient.redirectUris,
          grantTypes: oauthClient.grantTypes,
          scopes: oauthClient.scopes,
          disabled: oauthClient.disabled,
          createdAt: oauthClient.createdAt,
          referenceId: oauthClient.referenceId,
        })
        .from(oauthClient)
      return rows
        .filter((row) => row.referenceId !== 'system')
        .map((row) => ({
          clientId: row.clientId,
          name: row.name || row.clientId,
          uri: row.uri,
          redirectUris: parseStringArray(row.redirectUris),
          grantTypes: parseStringArray(row.grantTypes),
          scopes: parseStringArray(row.scopes),
          disabled: row.disabled === true,
          createdAt: toIso(row.createdAt),
        }))
    },

    async revokeJwtAccessToken(db, token) {
      const payload = decodeJwt(token)
      if (typeof payload.jti !== 'string' || typeof payload.client_id !== 'string' || typeof payload.exp !== 'number') {
        throw new Error('invalid_oauth_jwt_revocation')
      }
      await db
        .insert(oauthJwtRevocation)
        .values({
          id: payload.jti,
          clientId: payload.client_id,
          expiresAt: new Date(payload.exp * 1000),
          createdAt: new Date(),
        })
        .onConflictDoNothing({ target: oauthJwtRevocation.id })
    },

    async isJwtAccessTokenRevoked(db, tokenId) {
      const [row] = await db
        .select({ id: oauthJwtRevocation.id })
        .from(oauthJwtRevocation)
        .where(and(eq(oauthJwtRevocation.id, tokenId), gt(oauthJwtRevocation.expiresAt, new Date())))
        .limit(1)
      return Boolean(row)
    },

    async listGrants(db, userId) {
      const rows = await db
        .select({
          id: oauthConsent.id,
          clientId: oauthConsent.clientId,
          clientName: oauthClient.name,
          userId: oauthConsent.userId,
          orgId: oauthConsent.referenceId,
          scopes: oauthConsent.scopes,
          createdAt: oauthConsent.createdAt,
          lastUsedAt: oauthConsent.lastUsedAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
        .where(eq(oauthConsent.userId, userId))
      return rows.flatMap((row) => {
        if (!row.userId || !row.orgId) return []
        return [
          {
            id: row.id,
            clientId: row.clientId,
            clientName: row.clientName || row.clientId,
            userId: row.userId,
            orgId: row.orgId,
            scopes: parseScopes(row.scopes),
            createdAt: toIso(row.createdAt),
            lastUsedAt: row.lastUsedAt ? toIso(row.lastUsedAt) : null,
          },
        ]
      })
    },

    async revokeGrant(db, input) {
      const [grant] = await db
        .select({
          id: oauthConsent.id,
          clientId: oauthConsent.clientId,
          userId: oauthConsent.userId,
          referenceId: oauthConsent.referenceId,
        })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.id, input.grantId), eq(oauthConsent.userId, input.userId)))
        .limit(1)
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

function parseScopes(value: string | string[] | null): AuthorizationScope[] {
  if (Array.isArray(value)) return value.filter(isAuthorizationScope)
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed)
    ? parsed.filter((scope): scope is AuthorizationScope => typeof scope === 'string' && isAuthorizationScope(scope))
    : []
}

function parseStringArray(value: string | string[] | null): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function toIso(value: Date | number | string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('invalid_oauth_date')
  return date.toISOString()
}
