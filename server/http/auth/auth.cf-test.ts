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

describe('[CF] Auth API', () => {
  it('POST /api/auth/sign-up/email creates user', async () => {
    const app = await buildApp()
    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CF Test', email: `cf-${Date.now()}@example.com`, password: 'password123456' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { email: string } }
    expect(body.user.email).toContain('@example.com')
  })

  it('POST /api/auth/sign-in/email signs in', async () => {
    const app = await buildApp()
    const email = `cf-signin-${Date.now()}@example.com`
    await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CF Test', email, password: 'password123456' }),
    })
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123456' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('completes managed Agent OAuth consent on D1', async () => {
    const app = await buildApp()
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'CF Agent OAuth',
        email: `cf-agent-oauth-${Date.now()}@example.com`,
        password: 'password123456',
      }),
    })
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    const params = new URLSearchParams({
      client_id: 'zpan-agent',
      redirect_uri: 'http://127.0.0.1:8484/callback',
      response_type: 'code',
      scope: 'openid offline_access objects:read quota:read',
      state: 'cf-agent-oauth',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    })
    const authorize = await app.request(`/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie, Origin: 'http://localhost' },
    })
    const consentLocation = authorize.headers.get('location')
    expect(authorize.status).toBe(302)
    expect(consentLocation).toMatch(/^\/settings\/agent-access\?/)

    const consent = await app.request('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentLocation?.slice(consentLocation.indexOf('?') + 1),
      }),
    })
    const consentBody = await consent.text()

    expect(consent.status, consentBody).toBe(200)
    expect(JSON.parse(consentBody)).toMatchObject({
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:8484\/callback\?code=/),
    })
  })

  // Wrong password test is covered by Node tests (auth.test.ts).
  // Better Auth throws an unhandled rejection internally on auth failure
  // that leaks into the Miniflare isolate, causing a false test failure.
})
