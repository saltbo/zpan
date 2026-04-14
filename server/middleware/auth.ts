import { sql } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { findPersonalOrg, getMemberRole, isPersonalOrg } from '../services/org'
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
  const auth = c.get('auth')
  const result = (await auth.api.getSession({ headers: c.req.raw.headers })) as SessionWithPlugins | null

  if (result?.user?.id) {
    const db = c.get('platform').db
    const rows = await db.all<{ banned: number }>(sql`SELECT banned FROM user WHERE id = ${result.user.id}`)
    if (rows[0]?.banned) {
      return c.json({ error: 'Account disabled' }, 403)
    }
  }

  c.set('userId', result?.user?.id ?? null)
  c.set('userRole', result?.user?.role ?? null)

  if (result?.user?.id) {
    const orgId = result.session?.activeOrganizationId ?? (await findPersonalOrg(c.get('platform').db, result.user.id))
    c.set('orgId', orgId)
  } else {
    c.set('orgId', null)
  }

  await next()
})

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const userRole = c.get('userRole')
  if (userRole !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403)
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
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const db = c.get('platform').db

    // Query member role first — avoids an extra DB round trip for the common case.
    // Personal org owners always have a member row (guaranteed by findPersonalOrg),
    // so isPersonalOrg is only needed as a fallback when no member row exists.
    const role = await getMemberRole(db, orgId, userId)
    if (role !== null) {
      const userLevel = ROLE_LEVELS[role] ?? 0
      if (userLevel < ROLE_LEVELS[minRole]) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      await next()
      return
    }

    // No member row — could be a personal org accessed without a session refresh.
    if (await isPersonalOrg(db, orgId)) {
      await next()
      return
    }

    return c.json({ error: 'Forbidden' }, 403)
  })
}
