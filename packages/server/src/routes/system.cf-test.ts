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
  it('GET /api/system/options returns empty list without auth', async () => {
    const app = buildApp()
    const res = await app.request('/api/system/options')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('GET unknown option returns 404', async () => {
    const app = buildApp()
    const res = await app.request('/api/system/options/nonexistent_key')
    expect(res.status).toBe(404)
  })
})
