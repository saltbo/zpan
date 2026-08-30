import { type AuthorizationScope, isAuthorizationScope } from '@shared/authorization'
import { parseWorkspaceAuthorizationDetails } from '@shared/schemas'
import { and, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthJwtRevocation,
  oauthRefreshToken,
} from '../../db/auth-schema'
import { executeWriteTransaction } from '../../db/transaction'
import type { OAuthClient, OAuthGateway } from '../../usecases/ports'

const GRANT_USAGE_WRITE_INTERVAL_MS = 5 * 60 * 1000

export function createOAuthGateway(): OAuthGateway {
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
      } satisfies OAuthClient
    },

    async resolveAccountAccessToken(db, token, now = new Date()) {
      const storedToken = await hashOAuthToken(token)
      const [row] = await db
        .select({
          clientId: oauthAccessToken.clientId,
          userId: oauthAccessToken.userId,
          scopes: oauthAccessToken.scopes,
          clientDisabled: oauthClient.disabled,
        })
        .from(oauthAccessToken)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthAccessToken.clientId))
        .where(
          and(
            eq(oauthAccessToken.token, storedToken),
            isNull(oauthAccessToken.revoked),
            gt(oauthAccessToken.expiresAt, now),
          ),
        )
        .limit(1)
      if (!row?.userId || row.clientDisabled === true) return null
      return { clientId: row.clientId, userId: row.userId, scopes: parseScopes(row.scopes) }
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

    async recordGrantUsage(db, input) {
      const grants = await db
        .select({
          id: oauthConsent.id,
          authorizationDetails: oauthConsent.authorizationDetails,
        })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.clientId, input.clientId), eq(oauthConsent.userId, input.userId)))
      const grantIds = grants
        .filter((grant) => workspaceIdsFromAuthorizationDetails(grant.authorizationDetails).includes(input.workspaceId))
        .map((grant) => grant.id)
      if (grantIds.length === 0) return false

      const staleBefore = new Date(input.now.getTime() - GRANT_USAGE_WRITE_INTERVAL_MS)
      await db
        .update(oauthConsent)
        .set({ lastUsedAt: input.now })
        .where(
          and(
            inArray(oauthConsent.id, grantIds),
            or(isNull(oauthConsent.lastUsedAt), lt(oauthConsent.lastUsedAt, staleBefore)),
          ),
        )
      return true
    },

    async listGrants(db, userId) {
      const rows = await db
        .select({
          id: oauthConsent.id,
          clientId: oauthConsent.clientId,
          clientName: oauthClient.name,
          userId: oauthConsent.userId,
          authorizationDetails: oauthConsent.authorizationDetails,
          scopes: oauthConsent.scopes,
          createdAt: oauthConsent.createdAt,
          lastUsedAt: oauthConsent.lastUsedAt,
        })
        .from(oauthConsent)
        .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
        .where(eq(oauthConsent.userId, userId))
      return rows.flatMap((row) => {
        if (!row.userId) return []
        const workspaceIds = workspaceIdsFromAuthorizationDetails(row.authorizationDetails)
        if (workspaceIds.length === 0) return []
        return [
          {
            id: row.id,
            clientId: row.clientId,
            clientName: row.clientName || row.clientId,
            userId: row.userId,
            workspaceIds,
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
        })
        .from(oauthConsent)
        .where(and(eq(oauthConsent.id, input.grantId), eq(oauthConsent.userId, input.userId)))
        .limit(1)
      if (!grant?.userId) return false
      const refreshRows = await db
        .select({ id: oauthRefreshToken.id })
        .from(oauthRefreshToken)
        .where(
          and(
            eq(oauthRefreshToken.clientId, grant.clientId),
            eq(oauthRefreshToken.userId, grant.userId),
            isNull(oauthRefreshToken.revoked),
          ),
        )
      const refreshIds = refreshRows.map((row) => row.id)
      await executeWriteTransaction(db, [
        db
          .delete(oauthAccessToken)
          .where(and(eq(oauthAccessToken.clientId, grant.clientId), eq(oauthAccessToken.userId, grant.userId))),
        ...(refreshIds.length > 0
          ? [db.update(oauthRefreshToken).set({ revoked: input.now }).where(inArray(oauthRefreshToken.id, refreshIds))]
          : []),
        db.delete(oauthConsent).where(eq(oauthConsent.id, grant.id)),
      ])
      return true
    },
  }
}

function workspaceIdsFromAuthorizationDetails(value: unknown): string[] {
  if (value == null) return []
  return parseWorkspaceAuthorizationDetails(value).flatMap((detail) => (detail.identifier ? [detail.identifier] : []))
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

async function hashOAuthToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  const base64 = btoa(String.fromCharCode(...digest))
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
