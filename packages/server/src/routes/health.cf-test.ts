import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app'
import { createAuth } from '../auth'
import { createCloudflarePlatform } from '../platform/cloudflare'

function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return createApp(platform, auth)
}

describe('[CF] GET /api/health', () => {
  it('returns ok', async () => {
    const app = buildApp()
    const res = await app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
