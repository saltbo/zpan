import { createApp } from '../../server/app'
import { createAuth } from '../../server/auth'
import { createCloudflarePlatform } from '../../server/platform/cloudflare'

interface Env {
  DB: D1Database
  R2_BUCKET: R2Bucket
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  [key: string]: unknown
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const platform = createCloudflarePlatform(context.env)
  const auth = createAuth(platform.db, context.env.BETTER_AUTH_SECRET, context.env.BETTER_AUTH_URL)
  return createApp(platform, auth).fetch(context.request)
}
