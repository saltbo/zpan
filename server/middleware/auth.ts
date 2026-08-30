import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client'
import {
  AuthorizationScope,
  CANONICAL_AUTHORIZATION_SCOPES,
  isAuthorizationScope,
  permissionScopes,
} from '@shared/authorization'
import { parseWorkspaceAuthorizationDetails } from '@shared/schemas'
import { createDpopReplayStore } from 'better-auth/oauth2'
import { createMiddleware } from 'hono/factory'
import {
  isDownloaderBootstrapRegistrationRequest,
  isLegacyDownloaderBootstrapSession,
  LEGACY_DOWNLOADER_CLIENT_ID,
  LEGACY_DOWNLOADER_REGISTER_SCOPE,
} from '../domain/legacy-downloader-bootstrap'
import { ApiKeyRateLimitError, AppError, rateLimited, unauthorized } from '../usecases/ports'
import { anonymousAuthzContext, type Env } from './platform'

type SessionWithPlugins = {
  user: { id: string; role?: string }
  session: { activeOrganizationId?: string }
}

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.raw.headers.get('Authorization')
  if (authHeader?.startsWith('DPoP ')) {
    const auth = c.get('auth')
    const authContext = await auth.$context
    const audience = `${new URL(c.req.url).origin}/api`
    let payload: Awaited<
      ReturnType<ReturnType<ReturnType<typeof oauthProviderResourceClient>['getActions']>['verifyAccessTokenRequest']>
    >
    try {
      payload = await oauthProviderResourceClient(auth)
        .getActions()
        .verifyAccessTokenRequest(c.req.raw, {
          verifyOptions: { audience, issuer: authContext.baseURL },
          dpop: { replayStore: createDpopReplayStore(authContext.internalAdapter) },
        })
    } catch (error) {
      if (isUnauthorizedApiError(error)) throw mapOauthVerificationError(error, audience)
      throw error
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : null
    const orgId = workspaceOrgIdFromClaim(payload.authorization_details)
    const clientId = typeof payload.client_id === 'string' ? payload.client_id : null
    const actorClaims = payload.act && typeof payload.act === 'object' ? (payload.act as Record<string, unknown>) : null
    const actorSubject = actorClaims?.sub
    const actorIssuer = actorClaims?.iss
    if (!userId) throw invalidOauthToken(audience, 'OAUTH_SUBJECT_MISSING')
    if (!orgId) throw invalidOauthToken(audience, 'OAUTH_WORKSPACE_CLAIM_INVALID')
    if (!clientId) throw invalidOauthToken(audience, 'OAUTH_CLIENT_ID_MISSING')
    if (typeof actorSubject !== 'string') throw invalidOauthToken(audience, 'OAUTH_ACTOR_SUBJECT_MISSING')
    if (typeof actorIssuer !== 'string') throw invalidOauthToken(audience, 'OAUTH_ACTOR_ISSUER_MISSING')
    if (typeof payload.jti !== 'string') throw invalidOauthToken(audience, 'OAUTH_TOKEN_ID_MISSING')
    if (await c.get('deps').oauth.isJwtAccessTokenRevoked(c.get('platform').db, payload.jti)) {
      throw invalidOauthToken(audience, 'OAUTH_TOKEN_REVOKED')
    }
    if (await c.get('deps').userAdmin.isBanned(userId)) {
      throw invalidOauthToken(audience, 'OAUTH_SUBJECT_BANNED')
    }
    const grantActive = await c.get('deps').oauth.recordGrantUsage(c.get('platform').db, {
      clientId,
      userId,
      workspaceId: orgId,
      now: new Date(),
    })
    if (!grantActive) throw invalidOauthToken(audience, 'OAUTH_GRANT_INACTIVE')
    const role = (await c.get('deps').userAdmin.getSiteRole(userId)) ?? undefined
    const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(isAuthorizationScope) : []
    c.set('principal', {
      kind: 'oauth',
      actorIssuer,
      actorSubject,
      clientId,
      orgId,
      userId,
      scopes,
      authMethod: 'dpop',
    })
    c.set('authzContext', {
      credential: 'oauth',
      userId,
      workspace: { mode: 'bound', orgId },
      grantedScopes: new Set(scopes),
      actor: { type: 'oauth', ref: actorSubject, issuer: actorIssuer },
      state: { clientId, role },
    })
    c.set('userId', userId)
    c.set('userRole', null)
    c.set('orgId', orgId)
    await next()
    return
  }
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim()
    const platform = c.get('platform')
    const deps = c.get('deps')
    const taskUpload = await deps.downloadTokens.resolveTaskUploadToken(platform.db, platform, token)
    if (taskUpload) {
      c.set('principal', { ...taskUpload, kind: 'download-task-upload', authMethod: 'bearer' })
      c.set('authzContext', {
        credential: 'download-task-upload',
        userId: taskUpload.createdByUserId,
        workspace: { mode: 'bound', orgId: taskUpload.orgId },
        grantedScopes: new Set(taskUpload.scopes.filter(isAuthorizationScope)),
        actor: { type: 'device', ref: taskUpload.downloaderId },
        state: { downloaderId: taskUpload.downloaderId, taskId: taskUpload.taskId },
      })
      c.set('userId', null)
      c.set('userRole', null)
      c.set('orgId', taskUpload.orgId)
      await next()
      return
    }
    const downloader = await deps.downloadTokens.resolveDownloaderToken(platform, token)
    if (downloader) {
      c.set('principal', { kind: 'downloader', downloaderId: downloader.downloaderId, authMethod: 'bearer' })
      c.set('authzContext', {
        credential: 'downloader',
        userId: null,
        workspace: { mode: 'none', orgId: null },
        grantedScopes: new Set([
          AuthorizationScope.DOWNLOAD_TASKS_READ,
          AuthorizationScope.DOWNLOAD_TASKS_CANCEL,
          AuthorizationScope.DOWNLOADERS_UPDATE,
        ]),
        actor: { type: 'device', ref: downloader.downloaderId },
        state: {},
      })
      c.set('userId', null)
      c.set('userRole', null)
      c.set('orgId', null)
      await next()
      return
    }
    let apiKey: Awaited<ReturnType<typeof deps.apiKeys.verifyApiKey>>
    try {
      apiKey = await deps.apiKeys.verifyApiKey(c.get('auth'), platform.db, token)
    } catch (error) {
      if (error instanceof ApiKeyRateLimitError) {
        throw rateLimited(
          error.message,
          error.retryAfterMs === undefined ? undefined : Math.ceil(error.retryAfterMs / 1000),
        )
      }
      throw error
    }
    if (apiKey) {
      if (await deps.userAdmin.isBanned(apiKey.referenceId)) throw unauthorized('Unauthorized')
      const role = (await deps.userAdmin.getSiteRole(apiKey.referenceId)) ?? undefined
      const orgId = apiKey.scope.mode === 'workspace' ? apiKey.scope.orgId : null
      const userId = apiKey.referenceId
      c.set('principal', {
        kind: 'api-key',
        keyId: apiKey.id,
        configId: apiKey.configId,
        orgId,
        userId,
        scope: apiKey.scope,
        permissions: apiKey.permissions,
        authMethod: 'api-key',
      })
      c.set('authzContext', {
        credential: 'api_key',
        userId,
        workspace: orgId ? { mode: 'bound', orgId } : { mode: 'none', orgId: null },
        grantedScopes: new Set(permissionScopes(apiKey.permissions)),
        actor: { type: 'api_key', ref: apiKey.id },
        state: { configId: apiKey.configId, enabled: true, role },
      })
      c.set('userId', userId)
      c.set('userRole', null)
      c.set('orgId', orgId)
      await next()
      return
    }
    const bootstrap = await deps.downloaderBootstrapCredentials.resolve(platform, token, new Date())
    if (bootstrap) {
      if (await deps.userAdmin.isBanned(bootstrap.userId)) throw unauthorized('Unauthorized')
      const role = (await deps.userAdmin.getSiteRole(bootstrap.userId)) ?? undefined
      c.set('userId', bootstrap.userId)
      c.set('userRole', null)
      c.set('orgId', null)
      c.set('principal', {
        kind: 'downloader-bootstrap',
        userId: bootstrap.userId,
        sessionToken: token,
        scope: LEGACY_DOWNLOADER_REGISTER_SCOPE,
        authMethod: 'bearer',
      })
      c.set('authzContext', {
        credential: 'downloader-bootstrap',
        userId: bootstrap.userId,
        workspace: { mode: 'none', orgId: null },
        grantedScopes: new Set([AuthorizationScope.DOWNLOADERS_CREATE]),
        actor: { type: 'user', ref: bootstrap.userId },
        state: { clientId: LEGACY_DOWNLOADER_CLIENT_ID, scope: LEGACY_DOWNLOADER_REGISTER_SCOPE, role },
      })
      if (!bootstrap.active || !isDownloaderBootstrapRegistrationRequest(c.req.method, c.req.path)) {
        throw unauthorized('Unauthorized')
      }
      await next()
      return
    }
    await next()
    return
  }

  const auth = c.get('auth')
  const result = (await auth.api.getSession({ headers: c.req.raw.headers })) as SessionWithPlugins | null
  if (isLegacyDownloaderBootstrapSession(result?.session)) throw unauthorized('Unauthorized')

  c.set('userId', result?.user?.id ?? null)
  c.set('userRole', result?.user?.role ?? null)

  if (result?.user?.id) {
    const orgId = result.session?.activeOrganizationId ?? (await c.get('deps').org.findPersonalOrg(result.user.id))
    c.set('orgId', orgId)
    c.set('principal', {
      kind: 'user',
      userId: result.user.id,
      role: result.user.role,
      orgId,
      authMethod: authHeader?.startsWith('Bearer ') ? 'bearer' : 'cookie',
    })
    c.set('authzContext', {
      credential: 'session',
      userId: result.user.id,
      workspace: { mode: 'selected', orgId },
      grantedScopes: new Set(CANONICAL_AUTHORIZATION_SCOPES),
      actor: { type: 'user', ref: result.user.id },
      state: { firstParty: true, role: result.user.role },
    })
  } else {
    c.set('orgId', null)
    c.set('principal', null)
    c.set('authzContext', anonymousAuthzContext())
  }

  await next()
})

function invalidOauthToken(resource: string, diagnostic: string): AppError {
  return new AppError(401, 'Unauthorized', {
    diagnostics: { reason: diagnostic },
    headers: {
      'WWW-Authenticate': `DPoP error="invalid_token", resource_metadata="${resourceMetadataUrl(resource)}"`,
    },
  })
}

export function mapOauthVerificationError(error: unknown, resource: string): AppError {
  const candidate = error as Error & {
    body?: Record<string, unknown>
    headers?: HeadersInit
  }
  const description = oauthErrorDescription(candidate)
  const challenge = candidate.headers ? new Headers(candidate.headers).get('WWW-Authenticate') : null
  return new AppError(401, 'Unauthorized', {
    diagnostics: {
      reason: oauthDiagnosticReason(candidate.body?.error, description),
      message: description,
    },
    headers: {
      'WWW-Authenticate': challenge ?? `DPoP resource_metadata="${resourceMetadataUrl(resource)}"`,
    },
  })
}

function oauthErrorDescription(error: Error & { body?: Record<string, unknown> }): string {
  const description = error.body?.error_description
  if (typeof description === 'string' && description.length > 0) return description
  const bodyMessage = error.body?.message
  if (typeof bodyMessage === 'string' && bodyMessage.length > 0) return bodyMessage
  return error.message || 'OAuth access token verification failed'
}

function oauthDiagnosticReason(errorCode: unknown, description: string): string {
  const normalized = description.toLowerCase()
  if (normalized.includes('jti has already been used')) return 'OAUTH_DPOP_REPLAY'
  if (normalized.includes('iat is outside the accepted window')) return 'OAUTH_DPOP_PROOF_TIME_INVALID'
  if (normalized.includes('htu does not match')) return 'OAUTH_DPOP_URI_MISMATCH'
  if (normalized.includes('htm does not match')) return 'OAUTH_DPOP_METHOD_MISMATCH'
  if (normalized.includes('ath does not match')) return 'OAUTH_DPOP_TOKEN_HASH_MISMATCH'
  if (normalized.includes('key does not match the bound token')) return 'OAUTH_DPOP_KEY_MISMATCH'
  if (normalized.includes('proof header is required')) return 'OAUTH_DPOP_PROOF_MISSING'
  if (normalized.includes('token expired')) return 'OAUTH_TOKEN_EXPIRED'
  if (normalized.includes('invalid access token')) return 'OAUTH_TOKEN_INVALID'
  if (normalized.includes('missing authorization header')) return 'OAUTH_CREDENTIAL_MISSING'
  if (normalized.includes('authorization scheme')) return 'OAUTH_AUTHORIZATION_SCHEME_INVALID'
  if (errorCode === 'invalid_dpop_proof') return 'OAUTH_DPOP_PROOF_INVALID'
  if (errorCode === 'invalid_token') return 'OAUTH_TOKEN_INVALID'
  return 'OAUTH_TOKEN_VERIFICATION_FAILED'
}

function resourceMetadataUrl(resource: string): string {
  return new URL('/.well-known/oauth-protected-resource/api', resource).toString()
}

function isUnauthorizedApiError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { status?: unknown; statusCode?: unknown }
  return candidate.status === 'UNAUTHORIZED' || candidate.status === 401 || candidate.statusCode === 401
}

function workspaceOrgIdFromClaim(value: unknown): string | null {
  try {
    const details = parseWorkspaceAuthorizationDetails(value)
    return details.length === 1 ? (details[0].identifier ?? null) : null
  } catch {
    return null
  }
}
