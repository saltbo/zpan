import { createMiddleware } from 'hono/factory'
import { apiError } from '../http/openapi'
import type { Env } from './platform'

const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

export function requirePermission(
  resource: string,
  action: string,
  opts: { minTeamRole?: 'viewer' | 'editor' | 'owner'; allowDownloader?: boolean } = {},
) {
  return createMiddleware<Env>(async (c, next) => {
    const principal = c.get('principal')
    if (!principal) return apiError(c, 401, 'Unauthorized')

    if (principal.kind === 'downloader') {
      if (opts.allowDownloader) return next()
      return apiError(c, 401, 'Unauthorized')
    }

    if (principal.kind === 'download-task-upload') return apiError(c, 401, 'Unauthorized')

    if (principal.kind === 'api-key') {
      if (!c.get('deps').apiKeys.hasApiKeyPermission(principal.permissions, resource, action)) {
        return apiError(c, 403, 'Forbidden')
      }
      return next()
    }

    const userId = c.get('userId')
    if (!userId) return apiError(c, 401, 'Unauthorized')
    if (!opts.minTeamRole) return next()

    const orgId = c.get('orgId')
    if (!orgId) return apiError(c, 401, 'Unauthorized')

    const role = await c.get('deps').org.getMemberRole(orgId, userId)
    if (role !== null) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS[opts.minTeamRole]) return apiError(c, 403, 'Forbidden')
      return next()
    }
    if (await c.get('deps').org.isPersonalOrg(orgId)) return next()
    return apiError(c, 403, 'Forbidden')
  })
}
