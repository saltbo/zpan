import { describe, expect, it } from 'vitest'
import type { BrandingConfig } from '../../../shared/types'
import { adminHeaders, authedHeaders, createTestApp, seedProLicense as seedProLicenseRow } from '../../test/setup.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedProLicense(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await seedProLicenseRow(db)
}

async function seedBrandingOption(db: Awaited<ReturnType<typeof createTestApp>>['db'], key: string, value: string) {
  const { systemOptions } = await import('../../db/schema.js')
  await db.insert(systemOptions).values({ key, value, public: true })
}

// ─── GET /api/site/branding ────────────────────────────────────────────────────────

describe('GET /api/site/branding', () => {
  it('returns defaults when no branding configured [spec: branding/defaults]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/branding')
    expect(res.status).toBe(200)
    const body = (await res.json()) as BrandingConfig
    expect(body).toMatchObject({
      logo_url: null,
      favicon_url: null,
      wordmark_text: null,
      hide_powered_by: false,
      theme: {
        mode: 'preset',
        preset: 'default',
        custom: null,
        configured: false,
      },
    })
  })

  it('is accessible without authentication [spec: branding/public]', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/branding')
    expect(res.status).toBe(200)
  })

  it('returns stored branding values when set [spec: branding/stored-values]', async () => {
    const { app, db } = await createTestApp()
    await seedBrandingOption(db, 'branding_wordmark_text', 'MyCloud')
    await seedBrandingOption(db, 'branding_hide_powered_by', 'true')

    const res = await app.request('/api/site/branding')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wordmark_text: string; hide_powered_by: boolean }
    expect(body.wordmark_text).toBe('MyCloud')
    expect(body.hide_powered_by).toBe(true)
  })

  it('still returns a legacy absolute-URL logo/favicon unchanged [spec: branding/legacy-url-compat]', async () => {
    const { app, db } = await createTestApp()
    await seedBrandingOption(db, 'branding_logo_url', 'https://cdn.example.com/_system/branding/logo.svg')
    await seedBrandingOption(db, 'branding_favicon_url', 'https://cdn.example.com/_system/branding/favicon.png')

    const res = await app.request('/api/site/branding')
    expect(res.status).toBe(200)
    const body = (await res.json()) as BrandingConfig
    expect(body.logo_url).toBe('https://cdn.example.com/_system/branding/logo.svg')
    expect(body.favicon_url).toBe('https://cdn.example.com/_system/branding/favicon.png')
  })

  it('returns stored built-in theme values when set', async () => {
    const { app, db } = await createTestApp()
    await seedBrandingOption(db, 'branding_theme_mode', 'preset')
    await seedBrandingOption(db, 'branding_theme_preset', 'forest')

    const res = await app.request('/api/site/branding')
    expect(res.status).toBe(200)
    const body = (await res.json()) as BrandingConfig
    expect(body.theme).toMatchObject({
      mode: 'preset',
      preset: 'forest',
      custom: null,
      configured: true,
    })
  })

  it('returns stored custom theme values when set [spec: branding/custom-theme]', async () => {
    const { app, db } = await createTestApp()
    await seedBrandingOption(db, 'branding_theme_mode', 'custom')
    await seedBrandingOption(db, 'branding_theme_primary_color', '#123456')
    await seedBrandingOption(db, 'branding_theme_primary_foreground', '#fff')
    await seedBrandingOption(db, 'branding_theme_canvas_color', '#f1f5f9')
    await seedBrandingOption(db, 'branding_theme_sidebar_accent_color', '#dbeafe')
    await seedBrandingOption(db, 'branding_theme_ring_color', '#0f172a')

    const res = await app.request('/api/site/branding')
    expect(res.status).toBe(200)
    const body = (await res.json()) as BrandingConfig
    expect(body.theme).toMatchObject({
      mode: 'custom',
      configured: true,
      custom: {
        primary_color: '#123456',
        primary_foreground: '#fff',
        canvas_color: '#f1f5f9',
        sidebar_accent_color: '#dbeafe',
        ring_color: '#0f172a',
      },
    })
  })
})

// ─── PUT /api/site/branding ──────────────────────────────────────────────────

describe('PUT /api/site/branding', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/branding', { method: 'PUT' })
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin [spec: branding/admin-only]', async () => {
    const { app } = await createTestApp()
    // First user is auto-promoted to admin — create them first, then the non-admin
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'user@example.com')
    const res = await app.request('/api/site/branding', { method: 'PUT', headers })
    expect(res.status).toBe(403)
  })

  it('returns 402 when white_label feature is not available (no Pro) [spec: branding/white-label-gated]', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/branding', { method: 'PUT', headers })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { error: { details: { reason: string; metadata?: { feature?: string } }[] } }
    expect(body.error.details[0]?.reason).toBe('FEATURE_NOT_AVAILABLE')
    expect(body.error.details[0]?.metadata?.feature).toBe('white_label')
  })

  it('returns 415 when body is not multipart [spec: branding/multipart-required]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const res = await app.request('/api/site/branding', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(415)
  })

  it('returns 422 when wordmark_text exceeds 24 chars [spec: branding/wordmark-length]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('wordmark_text', 'x'.repeat(25))
    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(422)
  })

  it('saves wordmark_text and hide_powered_by without file upload [spec: branding/save-text]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('wordmark_text', 'MyCloud')
    form.set('hide_powered_by', 'true')

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wordmark_text: string; hide_powered_by: boolean }
    expect(body.wordmark_text).toBe('MyCloud')
    expect(body.hide_powered_by).toBe(true)

    // Verify GET reflects the update
    const getRes = await app.request('/api/site/branding')
    const getBody = (await getRes.json()) as { wordmark_text: string; hide_powered_by: boolean }
    expect(getBody.wordmark_text).toBe('MyCloud')
    expect(getBody.hide_powered_by).toBe(true)
  })

  it('saves a built-in theme selection [spec: branding/builtin-theme]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('theme_mode', 'preset')
    form.set('theme_preset', 'ocean')

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as BrandingConfig
    expect(body.theme).toMatchObject({ mode: 'preset', preset: 'ocean', configured: true })

    const getRes = await app.request('/api/site/branding')
    const getBody = (await getRes.json()) as BrandingConfig
    expect(getBody.theme).toMatchObject({ mode: 'preset', preset: 'ocean', configured: true })
  })

  it('saves custom theme colors when valid [spec: branding/save-custom-theme]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('theme_mode', 'custom')
    form.set('theme_primary_color', '#123')
    form.set('theme_primary_foreground', '#ffffff')
    form.set('theme_canvas_color', '#f8fafc')
    form.set('theme_sidebar_accent_color', '#dbeafe')
    form.set('theme_ring_color', '#0f172a')

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as BrandingConfig
    expect(body.theme.custom).toMatchObject({
      primary_color: '#123',
      primary_foreground: '#ffffff',
      canvas_color: '#f8fafc',
      sidebar_accent_color: '#dbeafe',
      ring_color: '#0f172a',
    })
  })

  it('returns 422 for invalid custom colors without changing stored theme [spec: branding/invalid-colors]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedBrandingOption(db, 'branding_theme_mode', 'preset')
    await seedBrandingOption(db, 'branding_theme_preset', 'forest')

    const form = new FormData()
    form.set('theme_mode', 'custom')
    form.set('theme_primary_color', 'blue')
    form.set('theme_primary_foreground', '#ffffff')
    form.set('theme_canvas_color', '#f8fafc')
    form.set('theme_sidebar_accent_color', '#dbeafe')
    form.set('theme_ring_color', '#0f172a')

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(422)

    const getRes = await app.request('/api/site/branding')
    const getBody = (await getRes.json()) as BrandingConfig
    expect(getBody.theme).toMatchObject({ mode: 'preset', preset: 'forest', configured: true })
  })

  it('returns 422 for inherited object property theme presets', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('theme_mode', 'preset')
    form.set('theme_preset', 'toString')

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(422)
  })

  it('stores an uploaded logo as a data URI — no public storage required [spec: branding/logo-upload]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    // Intentionally no storage seeded — branding must not depend on mode='public' storage.

    const svg = '<svg></svg>'
    const logoFile = new File([svg], 'logo.svg', { type: 'image/svg+xml' })
    const form = new FormData()
    form.set('logo', logoFile)

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { logo_url: string }
    const expected = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    expect(body.logo_url).toBe(expected)

    // GET reflects the same data URI.
    const getRes = await app.request('/api/site/branding')
    const getBody = (await getRes.json()) as BrandingConfig
    expect(getBody.logo_url).toBe(expected)
  })

  it('stores an uploaded favicon as a data URI [spec: branding/favicon-upload]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const bytes = new Uint8Array([1, 2, 3, 4, 5])
    const faviconFile = new File([bytes], 'favicon.ico', { type: 'image/x-icon' })
    const form = new FormData()
    form.set('favicon', faviconFile)

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { favicon_url: string }
    const expected = `data:image/x-icon;base64,${Buffer.from(bytes).toString('base64')}`
    expect(body.favicon_url).toBe(expected)
  })

  it('returns 400 for invalid logo MIME type [spec: branding/logo-mime]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const badFile = new File(['data'], 'malware.exe', { type: 'application/octet-stream' })
    const form = new FormData()
    form.set('logo', badFile)

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
  })

  it('returns 413 for a logo exceeding 256 KB [spec: branding/logo-size]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const bigFile = new File([new Uint8Array(256 * 1024 + 1)], 'big.png', { type: 'image/png' })
    const form = new FormData()
    form.set('logo', bigFile)

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(413)
  })

  it('returns 413 for a favicon exceeding 64 KB [spec: branding/favicon-size]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    // Under the 256 KB logo cap, but over the 64 KB favicon cap — proves per-field limits.
    const bigFile = new File([new Uint8Array(64 * 1024 + 1)], 'big.png', { type: 'image/png' })
    const form = new FormData()
    form.set('favicon', bigFile)

    const res = await app.request('/api/site/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(413)
  })
})

// ─── DELETE /api/site/branding/:field ────────────────────────────────────────

describe('DELETE /api/site/branding/:field', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/site/branding/logo', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('returns 402 without Pro feature', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/site/branding/logo', { method: 'DELETE', headers })
    expect(res.status).toBe(402)
  })

  it('resets a text field [spec: branding/reset-field]', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedBrandingOption(db, 'branding_wordmark_text', 'MyCloud')

    const res = await app.request('/api/site/branding/wordmark_text', { method: 'DELETE', headers })
    expect(res.status).toBe(204)

    // Verify removed from DB
    const { systemOptions } = await import('../../db/schema.js')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, 'branding_wordmark_text'))
    expect(rows.length).toBe(0)
  })

  it('resets theme fields', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedBrandingOption(db, 'branding_theme_mode', 'preset')
    await seedBrandingOption(db, 'branding_theme_preset', 'rose')

    const res = await app.request('/api/site/branding/theme', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    const getRes = await app.request('/api/site/branding')
    const body = (await getRes.json()) as BrandingConfig
    expect(body.theme).toMatchObject({
      mode: 'preset',
      preset: 'default',
      custom: null,
      configured: false,
    })
  })

  it('resets all theme settings from an individual theme field reset', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedBrandingOption(db, 'branding_theme_mode', 'preset')
    await seedBrandingOption(db, 'branding_theme_preset', 'rose')

    const res = await app.request('/api/site/branding/theme_preset', { method: 'DELETE', headers })
    expect(res.status).toBe(204)
    const getRes = await app.request('/api/site/branding')
    const body = (await getRes.json()) as BrandingConfig
    expect(body.theme.configured).toBe(false)
  })

  it('returns 400 for invalid field name', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const res = await app.request('/api/site/branding/invalid_field', { method: 'DELETE', headers })
    expect(res.status).toBe(400)
  })
})
