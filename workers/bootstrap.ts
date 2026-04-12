import { createApp } from '../server/app'
import { createAuth } from '../server/auth'
import { createCloudflarePlatform } from '../server/platform/cloudflare'

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  [key: string]: unknown
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS } = env
    if (!BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
    }
    const origin = new URL(request.url).origin
    const baseURL = BETTER_AUTH_URL || origin
    const platform = createCloudflarePlatform(env)
    const trustedOrigins = TRUSTED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) || [origin]
    const auth = createAuth(platform.db, BETTER_AUTH_SECRET, baseURL, trustedOrigins)
    return createApp(platform, auth).fetch(request)
  },
}
