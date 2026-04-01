import { createApp } from './app'
import { createAuth } from './auth'
import { createCloudflarePlatform } from './platform/cloudflare'

interface Env {
  DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  [key: string]: unknown
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const platform = createCloudflarePlatform(env)
    const auth = createAuth(platform.db, env.BETTER_AUTH_SECRET, env.BETTER_AUTH_URL)
    return createApp(platform, auth).fetch(request)
  },
}
