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

describe('[CF] System API', () => {
  it('GET /api/system/options/:key works without auth', async () => {
    const app = buildApp()
    const res = await app.request('/api/system/options/site_name')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ key: 'site_name', value: '' })
  })
})
