import { createMiddleware } from 'hono/factory'
import { forbidden, unauthorized } from '../usecases/ports'
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
    if (!principal) throw unauthorized('Unauthorized')

    if (principal.kind === 'downloader') {
      if (opts.allowDownloader) return next()
      throw unauthorized('Unauthorized')
    }

    if (principal.kind === 'download-task-upload') throw unauthorized('Unauthorized')

    if (principal.kind === 'api-key') {
      if (!c.get('deps').apiKeys.hasApiKeyPermission(principal.permissions, resource, action)) {
        throw forbidden('Forbidden')
      }
      return next()
    }

    const userId = c.get('userId')
    if (!userId) throw unauthorized('Unauthorized')
    if (!opts.minTeamRole) return next()

    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized('Unauthorized')

    const role = await c.get('deps').org.getMemberRole(orgId, userId)
    if (role !== null) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS[opts.minTeamRole]) throw forbidden('Forbidden')
      return next()
    }
    if (await c.get('deps').org.isPersonalOrg(orgId)) return next()
    throw forbidden('Forbidden')
  })
}
