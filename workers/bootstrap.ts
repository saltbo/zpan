import { createApp } from '../server/app'
import type { Auth } from '../server/auth'
import { createAuth } from '../server/auth'
import { createCloudflarePlatform } from '../server/platform/cloudflare'

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  [key: string]: unknown
}

// Cache auth instance at isolate scope to avoid per-request DB queries
// for OIDC config loading. Changes to OIDC provider configs or env vars
// (BETTER_AUTH_URL, TRUSTED_ORIGINS) take effect on isolate recycle.
let cachedAuth: Auth | null = null

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { BETTER_AUTH_SECRET } = env
    if (!BETTER_AUTH_SECRET) {
      throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
    }
    const platform = createCloudflarePlatform(env)

    if (!cachedAuth) {
      const origin = new URL(request.url).origin
      const baseURL = env.BETTER_AUTH_URL || origin
      const trustedOrigins = env.TRUSTED_ORIGINS?.split(',')
        .map((o) => o.trim())
        .filter(Boolean) || [origin]
      cachedAuth = await createAuth(platform.db, BETTER_AUTH_SECRET, baseURL, trustedOrigins)
    }

    return createApp(platform, cachedAuth).fetch(request)
  },
}
