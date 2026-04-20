import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from './bootstrap'

const testEnv = { ...env, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || 'ci-test-secret-that-is-at-least-32-chars' }

const fakeSpaHtml = '<html><head><title>ZPan</title></head><body></body></html>'
const fakeAssets = {
  fetch: (_req: RequestInfo | Request) =>
    Promise.resolve(new Response(fakeSpaHtml, { status: 200, headers: { 'Content-Type': 'text/html' } })),
} as unknown as Fetcher

describe('[CF] Worker fetch handler', () => {
  it('throws when BETTER_AUTH_SECRET is missing', async () => {
    const request = new Request('http://localhost/api/health')
    const envWithoutSecret = { ...env, BETTER_AUTH_SECRET: '' }
    await expect(worker.fetch(request, envWithoutSecret)).rejects.toThrow(
      'BETTER_AUTH_SECRET is not configured for this deployment.',
    )
  })

  it('returns a response for a valid request', async () => {
    const request = new Request('http://localhost/api/health')
    const res = await worker.fetch(request, testEnv)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('splits and trims TRUSTED_ORIGINS when provided', async () => {
    const request = new Request('http://localhost/api/health')
    const envWithOrigins = { ...testEnv, TRUSTED_ORIGINS: ' https://a.example.com , https://b.example.com ' }
    const res = await worker.fetch(request, envWithOrigins)
    expect(res.status).toBe(200)
  })
})

describe('[CF] SSR share OG meta injection', () => {
  it('injects real file name into og:title for valid landing share', async () => {
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
       VALUES ('ssr-matter-1', 'org-1', 'ssr-alias-1', 'design-spec.pdf', 'application/pdf', 4096, 0, '', 'obj/key.pdf', 'st-1', 'active', ?, ?)`,
    )
      .bind(now, now)
      .run()

    await env.DB.prepare(
      `INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, password_hash, expires_at, download_limit, views, downloads, status, created_at)
       VALUES ('ssr-share-1', 'ssrtoken01', 'landing', 'ssr-matter-1', 'org-1', 'user-1', NULL, NULL, NULL, 0, 0, 'active', ?)`,
    )
      .bind(now)
      .run()

    const testEnvWithAssets = { ...testEnv, ASSETS: fakeAssets }
    const res = await worker.fetch(new Request('http://localhost/s/ssrtoken01'), testEnvWithAssets)

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<meta property="og:title" content="design-spec.pdf"')
    expect(html).not.toContain('Share unavailable')
  })

  it('returns fallback OG meta for unknown share token', async () => {
    const testEnvWithAssets = { ...testEnv, ASSETS: fakeAssets }
    const res = await worker.fetch(new Request('http://localhost/s/no-such-token'), testEnvWithAssets)

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<meta property="og:title" content="Share unavailable"')
  })
})
