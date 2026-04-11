import { createApp } from '../../server/app'
import { createAuth } from '../../server/auth'
import { createCloudflarePlatform } from '../../server/platform/cloudflare'

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  [key: string]: unknown
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, TRUSTED_ORIGINS } = context.env
  if (!BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET is not configured for this deployment.')
  }
  const platform = createCloudflarePlatform(context.env)
  const trustedOrigins = TRUSTED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  const auth = createAuth(platform.db, BETTER_AUTH_SECRET, BETTER_AUTH_URL, trustedOrigins)
  return createApp(platform, auth).fetch(context.request)
}
