import { createMiddleware } from 'hono/factory'
import { hasApiKeyPermission } from '../services/api-keys'
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
    if (!principal) return c.json({ error: 'Unauthorized' }, 401)

    if (principal.kind === 'downloader') {
      if (opts.allowDownloader) return next()
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (principal.kind === 'download-task-upload') return c.json({ error: 'Unauthorized' }, 401)

    if (principal.kind === 'api-key') {
      if (!hasApiKeyPermission(principal.permissions, resource, action)) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      return next()
    }

    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    if (!opts.minTeamRole) return next()

    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)

    const db = c.get('platform').db
    const role = await c.get('deps').org.getMemberRole(orgId, userId)
    if (role !== null) {
      if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS[opts.minTeamRole]) return c.json({ error: 'Forbidden' }, 403)
      return next()
    }
    if (await c.get('deps').org.isPersonalOrg(orgId)) return next()
    return c.json({ error: 'Forbidden' }, 403)
  })
}
