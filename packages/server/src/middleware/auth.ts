import { sql } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { findPersonalOrg } from '../services/org'
import type { Env } from './platform'

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
