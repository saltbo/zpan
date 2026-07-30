import { AuthorizationScope, isAuthorizationScope, permissionScopes } from '@shared/authorization'
import { createMiddleware } from 'hono/factory'
import {
  isDownloaderBootstrapRegistrationRequest,
  isLegacyDownloaderBootstrapSession,
  LEGACY_DOWNLOADER_CLIENT_ID,
  LEGACY_DOWNLOADER_REGISTER_SCOPE,
} from '../domain/legacy-downloader-bootstrap'
import { ApiKeyRateLimitError, rateLimited, unauthorized } from '../usecases/ports'
import { anonymousAuthzContext, type Env } from './platform'

type SessionWithPlugins = {
  user: { id: string; role?: string }
  session: { activeOrganizationId?: string }
}

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const authHeader = c.req.raw.headers.get('Authorization')
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
        state: { configId: apiKey.configId, enabled: true },
      })
      c.set('userId', userId)
      c.set('userRole', null)
      c.set('orgId', orgId)
      await next()
      return
    }
    const agentOAuth = await deps.agentOAuth.verifyAccessToken(platform.db, token)
    if (agentOAuth) {
      if (await deps.userAdmin.isBanned(agentOAuth.userId)) throw unauthorized('Unauthorized')
      c.set('principal', {
        kind: 'agent-oauth',
        grantId: agentOAuth.grantId,
        clientId: agentOAuth.clientId,
        orgId: agentOAuth.orgId,
        userId: agentOAuth.userId,
        scopes: agentOAuth.scopes,
        authMethod: 'bearer',
      })
      c.set('authzContext', {
        credential: 'agent_oauth',
        userId: agentOAuth.userId,
        workspace: { mode: 'bound', orgId: agentOAuth.orgId },
        grantedScopes: new Set(agentOAuth.scopes),
        actor: { type: 'agent_oauth', ref: agentOAuth.grantId },
        state: { clientId: agentOAuth.clientId },
      })
      c.set('userId', agentOAuth.userId)
      c.set('userRole', null)
      c.set('orgId', agentOAuth.orgId)
      await next()
      return
    }
    const bootstrap = await deps.downloaderBootstrapCredentials.resolve(platform, token, new Date())
    if (bootstrap) {
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
        state: { clientId: LEGACY_DOWNLOADER_CLIENT_ID, scope: LEGACY_DOWNLOADER_REGISTER_SCOPE },
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
      grantedScopes: null,
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
