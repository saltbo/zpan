import { isAuthorizationScope, permissionScopes } from '@shared/authorization'
import { createMiddleware } from 'hono/factory'
import {
  isDownloaderBootstrapRegistrationRequest,
  isLegacyDownloaderBootstrapSession,
  LEGACY_DOWNLOADER_CLIENT_ID,
  LEGACY_DOWNLOADER_REGISTER_SCOPE,
} from '../domain/legacy-downloader-bootstrap'
import { ApiKeyRateLimitError, type CachePolicy, forbidden, rateLimited, unauthorized } from '../usecases/ports'
import { anonymousAuthzContext, type Env } from './platform'

// 'member' is the better-auth schema default; map it to viewer level so
// existing org members get read access rather than being silently denied.
const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  admin: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

const MEMBER_ROLE_CACHE_POLICY: CachePolicy<string | null> = {
  namespace: 'member-role',
  version: 1,
  ttlMs: 30_000,
  negativeTtlMs: 5_000,
  maxEntries: 1024,
  distributed: false,
  validate: (value): value is string | null => value === null || typeof value === 'string',
}

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
        orgId: taskUpload.orgId,
        fixedOrgId: taskUpload.orgId,
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
        orgId: null,
        fixedOrgId: null,
        grantedScopes: new Set(),
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
        orgId,
        fixedOrgId: orgId,
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
        orgId: agentOAuth.orgId,
        fixedOrgId: agentOAuth.orgId,
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
        orgId: null,
        fixedOrgId: null,
        grantedScopes: new Set(),
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
      orgId,
      fixedOrgId: null,
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

export const requireDownloader = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind !== 'downloader') throw unauthorized('Unauthorized')
  await next()
})

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  if (c.get('principal')?.kind !== 'user') {
    throw unauthorized('Unauthorized')
  }
  await next()
})

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const method = c.req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    const principal = c.get('principal')
    if (principal?.kind !== 'user') throw unauthorized('Unauthorized')
    if (principal.role !== 'admin') throw forbidden('Forbidden')
    await next()
    return
  }

  const freshSession = (await c.get('auth').api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
  })) as SessionWithPlugins | null
  if (!freshSession?.user?.id) throw unauthorized('Unauthorized')
  if (freshSession.user.role !== 'admin') {
    throw forbidden('Forbidden')
  }
  await next()
})

export const requireDownloaderRegistration = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind === 'downloader-bootstrap') {
    await next()
    return
  }
  if (principal?.kind !== 'user') throw unauthorized('Unauthorized')
  const freshSession = (await c.get('auth').api.getSession({
    headers: c.req.raw.headers,
    query: { disableCookieCache: true },
  })) as SessionWithPlugins | null
  if (!freshSession?.user?.id) throw unauthorized('Unauthorized')
  if (freshSession.user.role !== 'admin') throw forbidden('Forbidden')
  await next()
})

// requireTeamRole enforces a minimum role level for the current org.
// Personal orgs bypass the check — the owner of a personal space has full access.
// Must be used after requireAuth so orgId and userId are guaranteed non-null.
export function requireTeamRole(minRole: 'viewer' | 'editor' | 'owner') {
  return createMiddleware<Env>(async (c, next) => {
    const orgId = c.get('orgId')
    const userId = c.get('userId')
    if (!orgId || !userId) {
      throw unauthorized('Unauthorized')
    }

    const method = c.req.method.toUpperCase()
    const role =
      method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
        ? (
            await c
              .get('deps')
              .cache.getOrLoad(MEMBER_ROLE_CACHE_POLICY, `${orgId}:${userId}`, () =>
                c.get('deps').org.getMemberRole(orgId, userId),
              )
          ).value
        : await c.get('deps').org.getMemberRole(orgId, userId)
    if (role !== null) {
      const userLevel = ROLE_LEVELS[role] ?? 0
      if (userLevel < ROLE_LEVELS[minRole]) {
        throw forbidden('Forbidden')
      }
      await next()
      return
    }

    // No member row — could be a personal org accessed without a session refresh.
    if (await c.get('deps').org.isPersonalOrg(orgId)) {
      await next()
      return
    }

    throw forbidden('Forbidden')
  })
}
