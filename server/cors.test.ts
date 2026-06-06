import { describe, expect, it } from 'vitest'
import { createTestApp } from './test/setup.js'

describe('API CORS', () => {
  it('allows configured auth and trusted origins', async () => {
    const { app } = await createTestApp({
      BETTER_AUTH_URL: 'https://zpan.space',
      TRUSTED_ORIGINS: 'https://app.example.com',
    })

    const authOriginRes = await app.request('/api/auth/get-session', {
      headers: { Origin: 'https://zpan.space' },
    })
    expect(authOriginRes.headers.get('Access-Control-Allow-Origin')).toBe('https://zpan.space')

    const trustedOriginRes = await app.request('/api/auth/get-session', {
      headers: { Origin: 'https://app.example.com' },
    })
    expect(trustedOriginRes.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com')
  })

  it('does not reflect untrusted origins', async () => {
    const { app } = await createTestApp({
      BETTER_AUTH_URL: 'https://zpan.space',
      TRUSTED_ORIGINS: 'https://app.example.com',
    })

    const res = await app.request('/api/auth/get-session', {
      headers: { Origin: 'https://evil.example' },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })
})
