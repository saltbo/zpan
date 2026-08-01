import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../app'
import { createAuth } from '../../auth'
import { createCloudflarePlatform } from '../../platform/cloudflare'

async function buildApp() {
  const platform = createCloudflarePlatform(env)
  const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET, 'http://localhost')
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

  it('accepts official Workers commit and branch aliases but rejects unrelated workers.dev', async () => {
    const platform = createCloudflarePlatform(env)
    const configuredOrigin = 'https://zpan-staging.saltbo.workers.dev'
    const commitOrigin = 'https://99dc50ae-zpan.saltbo.workers.dev'
    const branchOrigin = 'https://feat-x402-paid-agent-uploads-zpan.saltbo.workers.dev'
    const auth = await createAuth(platform.db, env.BETTER_AUTH_SECRET, configuredOrigin, [configuredOrigin])
    const app = createApp(platform, auth)
    const email = `cf-preview-${Date.now()}@example.com`
    const password = 'password123456'
    const signUp = await app.request(`${configuredOrigin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { Origin: configuredOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CF Preview User', email, password }),
    })
    expect(signUp.status).toBe(200)

    for (const origin of [commitOrigin, branchOrigin]) {
      const signIn = await app.request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, callbackURL: `${origin}/files` }),
      })
      expect(signIn.status, await signIn.clone().text()).toBe(200)
    }

    const unrelatedOrigin = 'https://unrelated-worker.other-account.workers.dev'
    const rejected = await app.request(`${unrelatedOrigin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { Origin: unrelatedOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, callbackURL: `${unrelatedOrigin}/files` }),
    })
    expect(rejected.status).toBe(403)
  })

  it('completes managed OAuth consent on D1', async () => {
    const app = await buildApp()
    const signUp = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'CF OAuth',
        email: `cf-oauth-${Date.now()}@example.com`,
        password: 'password123456',
      }),
    })
    const cookie = signUp.headers
      .getSetCookie()
      .map((value) => value.split(';', 1)[0])
      .join('; ')
    const registration = await app.request('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'CF Consent Test Client',
        redirect_uris: ['https://broker.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'openid offline_access objects:read quota:read',
      }),
    })
    const registered = (await registration.json()) as { client_id: string }
    expect(registration.status).toBe(201)
    const params = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: 'https://broker.example.com/callback',
      response_type: 'code',
      scope: 'openid offline_access objects:read quota:read',
      state: 'cf-oauth',
      code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      code_challenge_method: 'S256',
    })
    const authorize = await app.request(`/api/auth/oauth2/authorize?${params}`, {
      headers: { Cookie: cookie, Origin: 'http://localhost' },
    })
    const consentLocation = authorize.headers.get('location')
    expect(authorize.status).toBe(302)
    expect(consentLocation).toMatch(/^\/settings\/oauth-apps\?/)

    const consent = await app.request('/api/oauth-consent', {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'http://localhost', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accept: true,
        oauthQuery: consentLocation?.slice(consentLocation.indexOf('?') + 1),
      }),
    })
    const consentBody = await consent.text()

    expect(consent.status, consentBody).toBe(200)
    expect(JSON.parse(consentBody)).toMatchObject({
      url: expect.stringMatching(/^https:\/\/broker\.example\.com\/callback\?code=/),
    })
  })

  // Wrong password test is covered by Node tests (auth.test.ts).
  // Better Auth throws an unhandled rejection internally on auth failure
  // that leaks into the Miniflare isolate, causing a false test failure.
})
