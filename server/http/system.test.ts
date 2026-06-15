import { describe, expect, it } from 'vitest'
import {
  CAPTCHA_ENABLED_KEY,
  CAPTCHA_MIN_SCORE_KEY,
  CAPTCHA_PROVIDER_KEY,
  CAPTCHA_SECRET_OPTION_KEY,
  CAPTCHA_SITE_KEY_KEY,
} from '../../shared/captcha.js'
import { adminHeaders, createTestApp } from '../test/setup.js'

async function putOption(
  app: Awaited<ReturnType<typeof createTestApp>>['app'],
  headers: Record<string, string>,
  key: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/site/options/${key}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('System API captcha options', () => {
  it('requires complete provider config before captcha can be enabled', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const noKeys = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true' })
    expect(noKeys.status).toBe(400)
    await expect(noKeys.json()).resolves.toEqual({ error: 'Captcha site key is required before enabling captcha' })

    await putOption(app, admin, CAPTCHA_SITE_KEY_KEY, { value: 'site-key' })
    const noSecret = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true' })
    expect(noSecret.status).toBe(400)
    await expect(noSecret.json()).resolves.toEqual({ error: 'Captcha secret key is required before enabling captcha' })

    await putOption(app, admin, CAPTCHA_SECRET_OPTION_KEY, { value: 'secret-key' })
    await putOption(app, admin, CAPTCHA_PROVIDER_KEY, { value: 'captchafox' })
    const enabled = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true' })
    expect(enabled.status).toBe(201)
  })

  it('forces captcha public and private visibility flags', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    const siteKey = await putOption(app, admin, CAPTCHA_SITE_KEY_KEY, { value: 'site-key', public: false })
    expect(await siteKey.json()).toEqual({ key: CAPTCHA_SITE_KEY_KEY, value: 'site-key', public: true })

    const secret = await putOption(app, admin, CAPTCHA_SECRET_OPTION_KEY, { value: 'secret-key', public: true })
    expect(await secret.json()).toEqual({ key: CAPTCHA_SECRET_OPTION_KEY, value: 'secret-key', public: false })

    const provider = await putOption(app, admin, CAPTCHA_PROVIDER_KEY, { value: 'hcaptcha', public: false })
    expect(await provider.json()).toEqual({ key: CAPTCHA_PROVIDER_KEY, value: 'hcaptcha', public: true })

    const minScore = await putOption(app, admin, CAPTCHA_MIN_SCORE_KEY, { value: '0.7', public: true })
    expect(await minScore.json()).toEqual({ key: CAPTCHA_MIN_SCORE_KEY, value: '0.7', public: false })

    const enabled = await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true', public: false })
    expect(await enabled.json()).toEqual({ key: CAPTCHA_ENABLED_KEY, value: 'true', public: true })
  })

  it('rejects invalid provider settings while captcha is enabled', async () => {
    const { app } = await createTestApp()
    const admin = await adminHeaders(app)

    await putOption(app, admin, CAPTCHA_PROVIDER_KEY, { value: 'google-recaptcha' })
    await putOption(app, admin, CAPTCHA_SITE_KEY_KEY, { value: 'site-key' })
    await putOption(app, admin, CAPTCHA_SECRET_OPTION_KEY, { value: 'secret-key' })
    await putOption(app, admin, CAPTCHA_ENABLED_KEY, { value: 'true' })

    const provider = await putOption(app, admin, CAPTCHA_PROVIDER_KEY, { value: 'unknown' })
    expect(provider.status).toBe(400)
    await expect(provider.json()).resolves.toEqual({ error: 'Captcha provider is invalid' })

    const minScore = await putOption(app, admin, CAPTCHA_MIN_SCORE_KEY, { value: '1.5' })
    expect(minScore.status).toBe(400)
    await expect(minScore.json()).resolves.toEqual({ error: 'Captcha minimum score must be between 0 and 1' })
  })
})
