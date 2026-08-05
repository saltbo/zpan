import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker, { resolveAuthBaseURL } from './bootstrap'

const testEnv = { ...env, BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET || 'ci-test-secret-that-is-at-least-32-chars' }

const fakeSpaHtml = '<html><head><title>ZPan</title></head><body></body></html>'
const fakeAssets = {
  fetch: (_req: RequestInfo | Request) =>
    Promise.resolve(new Response(fakeSpaHtml, { status: 200, headers: { 'Content-Type': 'text/html' } })),
} as unknown as Fetcher

describe('[CF] Worker fetch handler', () => {
  it('uses an official Workers preview alias as the auth base URL', () => {
    const configuredOrigin = 'https://zpan-staging.saltbo.workers.dev'

    expect(resolveAuthBaseURL(configuredOrigin, 'https://99dc50ae-zpan.saltbo.workers.dev')).toBe(
      'https://99dc50ae-zpan.saltbo.workers.dev',
    )
    expect(resolveAuthBaseURL(configuredOrigin, 'https://feat-preview-zpan.saltbo.workers.dev')).toBe(
      'https://feat-preview-zpan.saltbo.workers.dev',
    )
    expect(resolveAuthBaseURL(configuredOrigin, 'https://unrelated.saltbo.workers.dev')).toBe(configuredOrigin)
  })

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

  it('publishes the Arazzo workflow description from the Worker runtime', async () => {
    const root = await worker.fetch(new Request('https://pan.example.com/api'), testEnv)
    const workflow = await worker.fetch(new Request('https://pan.example.com/api/workflows.arazzo.json'), testEnv)

    expect(root.status).toBe(200)
    expect(root.headers.get('Link')).toContain(
      '</api/workflows.arazzo.json>; rel="describedby"; type="application/vnd.oai.workflows+json"',
    )
    expect(workflow.status).toBe(200)
    expect(workflow.headers.get('Content-Type')).toBe('application/vnd.oai.workflows+json; version=1.1.0')
    expect(await workflow.json()).toMatchObject({
      arazzo: '1.1.0',
      $self: 'https://pan.example.com/api/workflows.arazzo.json',
      sourceDescriptions: [{ url: './openapi.json', type: 'openapi' }],
    })
  })

  it('splits and trims TRUSTED_ORIGINS when provided', async () => {
    const request = new Request('http://localhost/api/health')
    const envWithOrigins = { ...testEnv, TRUSTED_ORIGINS: ' https://a.example.com , https://b.example.com ' }
    const res = await worker.fetch(request, envWithOrigins)
    expect(res.status).toBe(200)
  })

  it('routes the WebDAV mount root with and without trailing slash', async () => {
    for (const path of ['/dav', '/dav/']) {
      const res = await worker.fetch(new Request(`http://localhost${path}`, { method: 'PROPFIND' }), testEnv)
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="ZPan WebDAV"')
    }
  })

  it('keeps auth initialization isolated between the DAV and primary hostnames', async () => {
    const dav = await worker.fetch(new Request('https://dav.example.com/dav/', { method: 'PROPFIND' }), testEnv)
    expect(dav.status).toBe(401)

    const primary = await worker.fetch(new Request('https://pan.example.com/api/health'), testEnv)
    expect(primary.status).toBe(200)
  })

  it('keeps authenticated sessions usable on an official Workers preview alias', async () => {
    const configuredOrigin = 'https://zpan-staging.saltbo.workers.dev'
    const previewOrigin = 'https://99dc50ae-zpan.saltbo.workers.dev'
    const previewEnv = {
      ...testEnv,
      BETTER_AUTH_URL: configuredOrigin,
      TRUSTED_ORIGINS: configuredOrigin,
    }
    const email = `worker-preview-${Date.now()}@example.com`
    const password = 'password123456'
    const headers = { Origin: previewOrigin, 'Content-Type': 'application/json' }

    const signUp = await worker.fetch(
      new Request(`${previewOrigin}/api/auth/sign-up/email`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Worker Preview User', email, password }),
      }),
      previewEnv,
    )
    expect(signUp.status, await signUp.clone().text()).toBe(200)

    const signIn = await worker.fetch(
      new Request(`${previewOrigin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password, callbackURL: `${previewOrigin}/files` }),
      }),
      previewEnv,
    )
    expect(signIn.status, await signIn.clone().text()).toBe(200)
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')

    const session = await worker.fetch(
      new Request(`${previewOrigin}/api/auth/get-session`, { headers: { Cookie: cookie } }),
      previewEnv,
    )
    expect(session.status, await session.clone().text()).toBe(200)
    await expect(session.json()).resolves.toMatchObject({ user: { email } })
  })

  it('serves public config from the Worker response cache after the first request', async () => {
    const request = new Request('https://cache-test.example.com/api/configz')
    const firstCtx = createExecutionContext()
    const first = await worker.fetch(request, testEnv, firstCtx)
    await waitOnExecutionContext(firstCtx)

    expect(first.status).toBe(200)
    expect(first.headers.get('x-zpan-cache')).not.toBe('edge')

    const secondCtx = createExecutionContext()
    const second = await worker.fetch(request, testEnv, secondCtx)
    await waitOnExecutionContext(secondCtx)

    expect(second.status).toBe(200)
    expect(second.headers.get('x-zpan-cache')).toBe('edge')
  })
})

describe('[CF] SSR share OG meta injection', () => {
  it('injects real file name into og:title for valid landing share', async () => {
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO matters (id, org_id, alias, name, type, size, dirtype, parent, object, storage_id, status, created_at, updated_at)
       VALUES ('ssrmatter1', 'org1', 'ssralias1', 'design-spec.pdf', 'application/pdf', 4096, 0, '', 'obj/key.pdf', 'st1', 'active', ?, ?)`,
    )
      .bind(now, now)
      .run()

    await env.DB.prepare(
      `INSERT INTO shares (id, token, kind, matter_id, org_id, creator_id, password_hash, expires_at, download_limit, views, downloads, status, created_at)
       VALUES ('ssrshare1', 'ssrtoken01', 'landing', 'ssrmatter1', 'org1', 'user1', NULL, NULL, NULL, 0, 0, 'active', ?)`,
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
