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
      if (isUnauthorizedApiError(error)) throw dpopUnauthorized(audience)
      throw error
    }
    const userId = typeof payload.sub === 'string' ? payload.sub : null
    const orgId = workspaceOrgIdFromClaim(payload.authorization_details)
    const clientId = typeof payload.client_id === 'string' ? payload.client_id : null
    const actorClaims = payload.act && typeof payload.act === 'object' ? (payload.act as Record<string, unknown>) : null
    const actorSubject = actorClaims?.sub
    const actorIssuer = actorClaims?.iss
    if (!userId || !orgId || !clientId || typeof actorSubject !== 'string' || typeof actorIssuer !== 'string') {
      throw unauthorized('Unauthorized')
    }
    if (
      typeof payload.jti !== 'string' ||
      (await c.get('deps').oauth.isJwtAccessTokenRevoked(c.get('platform').db, payload.jti))
    ) {
      throw dpopUnauthorized(audience)
    }
    if (await c.get('deps').userAdmin.isBanned(userId)) throw unauthorized('Unauthorized')
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
        actor: { type: 'task-upload', ref: taskUpload.taskId },
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
        actor: { type: 'downloader', ref: downloader.downloaderId },
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

function dpopUnauthorized(resource: string): AppError {
  return new AppError(401, 'Unauthorized', {
    headers: {
      'WWW-Authenticate': `DPoP resource_metadata="${new URL('/.well-known/oauth-protected-resource/api', resource).toString()}"`,
    },
  })
}

function isUnauthorizedApiError(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'APIError') return false
  const candidate = error as Error & { status?: unknown; statusCode?: unknown }
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
