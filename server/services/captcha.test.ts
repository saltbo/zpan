import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAPTCHA_ENABLED_KEY, CAPTCHA_SECRET_OPTION_KEY } from '../../shared/captcha.js'
import { systemOptions } from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import { isCaptchaEnabled, verifyCaptchaToken } from './captcha.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captcha service', () => {
  it('treats absent settings as disabled', async () => {
    const { db } = await createTestApp()

    expect(await isCaptchaEnabled(db)).toBe(false)
    expect(await verifyCaptchaToken(db, undefined)).toBe(true)
  })

  it('rejects missing tokens when captcha is enabled', async () => {
    const { db } = await createTestApp()
    await db.insert(systemOptions).values({ key: CAPTCHA_ENABLED_KEY, value: 'true', public: true })

    expect(await verifyCaptchaToken(db, undefined)).toBe(false)
  })

  it('requires a secret key when captcha is enabled', async () => {
    const { db } = await createTestApp()
    await db.insert(systemOptions).values({ key: CAPTCHA_ENABLED_KEY, value: 'true', public: true })

    await expect(verifyCaptchaToken(db, 'token')).rejects.toThrow(
      'Captcha is enabled but the Turnstile secret key is missing',
    )
  })

  it('verifies tokens against Turnstile with the stored secret key', async () => {
    const { db } = await createTestApp()
    await db.insert(systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true', public: true },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))))

    expect(await verifyCaptchaToken(db, 'token', '203.0.113.1')).toBe(true)

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.method).toBe('POST')
    const body = init.body as FormData
    expect(body.get('secret')).toBe('secret-key')
    expect(body.get('response')).toBe('token')
    expect(body.get('remoteip')).toBe('203.0.113.1')
  })

  it('surfaces Turnstile HTTP errors', async () => {
    const { db } = await createTestApp()
    await db.insert(systemOptions).values([
      { key: CAPTCHA_ENABLED_KEY, value: 'true', public: true },
      { key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false },
    ])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })))

    await expect(verifyCaptchaToken(db, 'token')).rejects.toThrow('Captcha verification failed with HTTP 500')
  })
})
