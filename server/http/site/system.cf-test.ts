import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../app'
import { createAuth } from '../../auth'
import { createCloudflarePlatform } from '../../platform/cloudflare'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET)
  return createApp(platform, auth)
}

describe('[CF] System API', () => {
  it('GET /api/configz returns structured public configuration', async () => {
    const app = await buildApp()
    const res = await app.request('https://pan.example.com/api/configz')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { site: { publicUrl: string }; services: { webdav: { url: string } } }
    expect(body.site.publicUrl).toBe('https://pan.example.com')
    expect(body.services.webdav.url).toBe('https://dav.pan.example.com/')
  })

  it('does not expose the removed generic Options API', async () => {
    const app = await buildApp()
    const res = await app.request('/api/site/options')
    expect(res.status).toBe(404)
  })
})
