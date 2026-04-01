import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { createApp } from './app'
import { createAuth } from './auth'
import { createCloudflarePlatform } from './platform/cloudflare'

type Env = {
  Bindings: {
    DB: D1Database
    BETTER_AUTH_SECRET: string
    BETTER_AUTH_URL?: string
  }
}

const app = new Hono<Env>().all('/*', (c) => {
  const platform = createCloudflarePlatform(c.env)
  const auth = createAuth(platform.db, c.env.BETTER_AUTH_SECRET, c.env.BETTER_AUTH_URL)
  return createApp(platform, auth).fetch(c.req.raw)
})

export const onRequest = handle(app)
