import { handle } from 'hono/cloudflare-pages'
import { createApp } from './app'
import { createAuth } from './auth'
import { createCloudflarePlatform } from './platform/cloudflare'

interface CloudflareEnv {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  [key: string]: unknown
}

export const onRequest: PagesFunction<CloudflareEnv> = (context) => {
  const platform = createCloudflarePlatform(context.env)
  const auth = createAuth(platform.db, context.env.BETTER_AUTH_SECRET, context.env.BETTER_AUTH_URL)
  const app = createApp(platform, auth)
  return handle(app)(context)
}
