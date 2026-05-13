import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPTCHA_ENABLED_KEY, CAPTCHA_SECRET_OPTION_KEY, CAPTCHA_SITE_KEY_KEY } from '../shared/captcha.js'
import { systemOptions } from './db/schema.js'
import { createTestApp } from './test/setup.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auth captcha guard', () => {
  it('rejects email auth before Better Auth when captcha token is missing', async () => {
    const { app, db } = await createTestApp()
    await db.insert(systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true', public: true },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key', public: true },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false },
    ])

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test', email: 'guard@example.com', password: 'password123456' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid captcha token' })
  })

  it('passes verified captcha tokens through to Better Auth', async () => {
    const { app, db } = await createTestApp()
    await db.insert(systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true', public: true },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key', public: true },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))))

    const res = await app.request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test',
        email: 'guard-valid@example.com',
        password: 'password123456',
        captchaToken: 'token',
      }),
    })

    expect(res.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects social auth when captcha is enabled', async () => {
    const { app, db } = await createTestApp()
    await db.insert(systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true', public: true },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key', public: true },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false },
    ])

    const res = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/files' }),
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Captcha is required for social authentication' })
  })

  it('leaves social auth with Better Auth when captcha is disabled', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'github', callbackURL: '/files' }),
    })

    expect(await res.text()).not.toContain('Captcha is required for social authentication')
  })

  it('rejects malformed captcha auth payloads when captcha is enabled', async () => {
    const { app, db } = await createTestApp()
    await db.insert(systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true', public: true },
      { key: CAPTCHA_SITE_KEY_KEY, value: 'site-key', public: true },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false },
    ])

    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Invalid captcha token' })
  })
})
