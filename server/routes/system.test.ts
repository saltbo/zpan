import { describe, expect, it } from 'vitest'
import { CAPTCHA_ENABLED_KEY, CAPTCHA_SECRET_OPTION_KEY, CAPTCHA_SITE_KEY_KEY } from '../../shared/captcha.js'
import { adminHeaders, createTestApp } from '../test/setup.js'

async function putOption(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  headers: Record<string, string>,
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/system/options/${key}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('System API captcha options', () => {
  it('requires both Turnstile keys before captcha can be enabled', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const noKeys = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true' })
    expect(noKeys.status).toBe(400)
    await expect(noKeys.json()).resolves.toEqual({ error: 'Captcha site key is required before enabling captcha' })

    await putOption(app, admin, CAPTCHA_SITE_KEY_KEY, { value: 'site-key' })
    const noSecret = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true' })
    expect(noSecret.status).toBe(400)
    await expect(noSecret.json()).resolves.toEqual({ error: 'Captcha secret key is required before enabling captcha' })
  })

  it('forces captcha public and private visibility flags', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const siteKey = await putOption(app, admin, CAPTCHA_SITE_KEY_KEY, { value: 'site-key', public: false })
    expect(await siteKey.json()).toEqual({ key: CAPTCHA_SITE_KEY_KEY, value: 'site-key', public: true })

    const secret = await putOption(app, admin, CAPTCHA_SECRET_OPTION_KEY, { value: 'secret-key', public: true })
    expect(await secret.json()).toEqual({ key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false })

    const enabled = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true', public: false })
    expect(await enabled.json()).toEqual({ key: CAPTCHA_ENABLED_KEY, value: 'true', public: true })
  })
})
