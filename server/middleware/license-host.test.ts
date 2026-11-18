import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { getSitePublicOrigin } from '../usecases/site/public-origin'
import { licenseRequestHost } from './license-host'
import type { Env } from './platform'

vi.mock('../usecases/site/public-origin', () => ({
  getSitePublicOrigin: vi.fn(async () => 'https://production.example' as string | null),
}))

describe('license request host shared by UI and feature authorization', () => {
  it('ignores forwarded host when no public origin is configured outside Preview', async () => {
    vi.mocked(getSitePublicOrigin).mockResolvedValueOnce(null)
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('platform', { getEnv: () => 'false' } as never)
      c.set('deps', {} as never)
      await next()
    })
    app.get('/', async (c) => c.text(await licenseRequestHost(c)))
    const response = await app.request('https://actual.example/', {
      headers: { host: 'actual.example', 'x-forwarded-host': 'authorized.example' },
    })
    expect(await response.text()).toBe('actual.example')
  })

  it.each([
    ['true', 'pr-1-zpan.saltbo.workers.dev'],
    ['false', 'production.example'],
  ])('selects the request host only in preview mode %s', async (preview, expected) => {
    const app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('platform', { getEnv: () => preview } as never)
      c.set('deps', {} as never)
      await next()
    })
    app.get('/', async (c) => c.text(await licenseRequestHost(c)))
    const response = await app.request('https://pr-1-zpan.saltbo.workers.dev/', {
      headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' },
    })
    expect(await response.text()).toBe(expected)
  })
})
