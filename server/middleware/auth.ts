import { createMiddleware } from 'hono/factory'
import { ApiKeyRateLimitError, forbidden, rateLimited, unauthorized } from '../usecases/ports'
import type { Env } from './platform'

// 'member' is the better-auth schema default; map it to viewer level so
// existing org members get read access rather than being silently denied.
const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  member: 1,
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
      c.set('userId', null)
      c.set('userRole', null)
      c.set('orgId', taskUpload.orgId)
      await next()
      return
    }
    const downloader = await deps.downloadTokens.resolveDownloaderToken(platform, token)
    if (downloader) {
      c.set('principal', { kind: 'downloader', downloaderId: downloader.downloaderId, authMethod: 'bearer' })
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
      const orgId = deps.apiKeys.isOrgApiKey(apiKey.configId) ? apiKey.referenceId : null
      const userId = deps.apiKeys.isOrgApiKey(apiKey.configId) ? null : apiKey.referenceId
      c.set('principal', {
        kind: 'api-key',
        keyId: apiKey.id,
        configId: apiKey.configId,
        orgId,
        userId,
        permissions: apiKey.permissions,
        authMethod: 'api-key',
      })
      c.set('userId', userId)
      c.set('userRole', null)
      c.set('orgId', orgId)
      await next()
      return
    }
  }

  const auth = c.get('auth')
  const result = (await auth.api.getSession({ headers: c.req.raw.headers })) as SessionWithPlugins | null

  if (result?.user?.id) {
    if (await c.get('deps').userAdmin.isBanned(result.user.id)) {
      throw forbidden('Account disabled')
    }
  }

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
  } else {
    c.set('orgId', null)
    c.set('principal', null)
  }

  await next()
})

export const requireDownloader = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind !== 'downloader') throw unauthorized('Unauthorized')
  await next()
})

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    throw unauthorized('Unauthorized')
  }
  await next()
})

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    throw unauthorized('Unauthorized')
  }
  const userRole = c.get('userRole')
  if (userRole !== 'admin') {
    throw forbidden('Forbidden')
  }
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

    // Query member role first — avoids an extra DB round trip for the common case.
    // Personal org owners always have a member row (guaranteed by findPersonalOrg),
    // so isPersonalOrg is only needed as a fallback when no member row exists.
    const role = await c.get('deps').org.getMemberRole(orgId, userId)
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
