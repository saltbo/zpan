import { createMiddleware } from 'hono/factory'
import type { Deps } from '../usecases/deps'
import { forbidden, unauthorized } from '../usecases/ports'
import type { Env } from './platform'

const ROLE_LEVELS: Record<string, number> = {
  owner: 3,
  editor: 2,
  viewer: 1,
  member: 1,
}

type TeamRole = 'viewer' | 'editor' | 'owner'

async function assertMinimumTeamRole(org: Deps['org'], orgId: string, userId: string, minRole: TeamRole) {
  const role = await org.getMemberRole(orgId, userId)
  if (role !== null) {
    if ((ROLE_LEVELS[role] ?? 0) < ROLE_LEVELS[minRole]) throw forbidden('Forbidden')
    return
  }
  if (await org.isPersonalOrg(orgId)) return
  throw forbidden('Forbidden')
}

export function requireTeamRole(minRole: TeamRole) {
  return createMiddleware<Env>(async (c, next) => {
    const principal = c.get('principal')
    if (!principal) throw unauthorized('Unauthorized')
    if (principal.kind === 'downloader' || principal.kind === 'download-task-upload') {
      throw unauthorized('Unauthorized')
    }

    const orgId = c.get('orgId')
    const userId = c.get('userId')
    if (!orgId || !userId) throw unauthorized('Unauthorized')

    await assertMinimumTeamRole(c.get('deps').org, orgId, userId, minRole)
    return next()
  })
}

export function requirePermission(
  resource: string,
  action: string,
  opts: { minTeamRole?: TeamRole; allowDownloader?: boolean } = {},
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
      if (principal.scope.mode === 'workspace') {
        const minRole = opts.minTeamRole ?? 'editor'
        await assertMinimumTeamRole(c.get('deps').org, principal.scope.orgId, principal.userId, minRole)
      }
      return next()
    }

    const userId = c.get('userId')
    if (!userId) throw unauthorized('Unauthorized')
    if (!opts.minTeamRole) return next()

    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized('Unauthorized')

    await assertMinimumTeamRole(c.get('deps').org, orgId, userId, opts.minTeamRole)
    return next()
  })
}
