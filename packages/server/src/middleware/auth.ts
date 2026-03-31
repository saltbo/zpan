import { createMiddleware } from 'hono/factory'
import type { Env } from './platform'

export const authMiddleware = createMiddleware<Env>(async (c, next) => {
  const auth = c.get('auth')
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  c.set('userId', session?.user?.id ?? null)
  await next()
})

export const requireAuth = createMiddleware<Env>(async (c, next) => {
  const userId = c.get('userId')
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})
