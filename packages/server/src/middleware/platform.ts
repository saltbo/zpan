import { createMiddleware } from 'hono/factory'
import type { Platform } from '../platform/interface'
import type { Auth } from '../auth'

export type Env = {
  Variables: {
    platform: Platform
    auth: Auth
    userId: string | null
  }
}

export const platformMiddleware = (platform: Platform, auth: Auth) =>
  createMiddleware<Env>(async (c, next) => {
    c.set('platform', platform)
    c.set('auth', auth)
    await next()
  })
