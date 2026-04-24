import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S3Service } from '../services/s3.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = Date.now()

async function seedProLicense(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  const { licenseBinding } = await import('../db/schema.js')
  await db.insert(licenseBinding).values({
    id: 1,
    instanceId: 'test-instance',
    refreshToken: 'tok',
    cachedCert: JSON.stringify({
      plan: 'pro',
      features: ['white_label'],
      account_id: 'a',
      instance_id: 'test-instance',
      issued_at: '2025-01-01',
      expires_at: '2099-01-01',
    }),
    cachedExpiresAt: Math.floor(Date.now() / 1000) + 99999,
  })
}

async function seedPublicStorage(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await db.run(sql`
    INSERT INTO storages (id, title, mode, bucket, endpoint, region, access_key, secret_key, file_path, custom_host, capacity, used, status, created_at, updated_at)
    VALUES ('branding-storage', 'Public', 'public', 'test-bucket', 'https://s3.example.com', 'us-east-1', 'key', 'secret', '', '', 0, 0, 'active', ${NOW}, ${NOW})
  `)
}

async function seedBrandingOption(db: Awaited<ReturnType<typeof createTestApp>>['db'], key: string, value: string) {
  const { systemOptions } = await import('../db/schema.js')
  await db.insert(systemOptions).values({ key, value, public: true })
}

// ─── GET /api/branding ────────────────────────────────────────────────────────

describe('GET /api/branding', () => {
  it('returns defaults when no branding configured', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/branding')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      logo_url: null,
      favicon_url: null,
      wordmark_text: null,
      hide_powered_by: false,
    })
  })

  it('is accessible without authentication', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/branding')
    expect(res.status).toBe(200)
  })

  it('returns stored branding values when set', async () => {
    const { app, db } = await createTestApp()
    await seedBrandingOption(db, 'branding_wordmark_text', 'MyCloud')
    await seedBrandingOption(db, 'branding_hide_powered_by', 'true')

    const res = await app.request('/api/branding')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wordmark_text: string; hide_powered_by: boolean }
    expect(body.wordmark_text).toBe('MyCloud')
    expect(body.hide_powered_by).toBe(true)
  })
})

// ─── PUT /api/admin/branding ──────────────────────────────────────────────────

describe('PUT /api/admin/branding', () => {
  beforeEach(() => {
    vi.spyOn(S3Service.prototype, 'putObject').mockResolvedValue(undefined)
    vi.spyOn(S3Service.prototype, 'getPublicUrl').mockReturnValue('https://cdn.example.com/logo.png')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/branding', { method: 'PUT' })
    expect(res.status).toBe(401)
  })

  it('returns 403 for non-admin', async () => {
    const { app } = await createTestApp()
    // First user is auto-promoted to admin — create them first, then the non-admin
    await adminHeaders(app)
    const headers = await authedHeaders(app, 'user@example.com')
    const res = await app.request('/api/admin/branding', { method: 'PUT', headers })
    expect(res.status).toBe(403)
  })

  it('returns 402 when white_label feature is not available (no Pro)', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/branding', { method: 'PUT', headers })
    expect(res.status).toBe(402)
    const body = (await res.json()) as { feature: string }
    expect(body.feature).toBe('white_label')
  })

  it('returns 415 when body is not multipart', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    const res = await app.request('/api/admin/branding', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(415)
  })

  it('returns 422 when wordmark_text exceeds 24 chars', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('wordmark_text', 'x'.repeat(25))
    const res = await app.request('/api/admin/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(422)
  })

  it('saves wordmark_text and hide_powered_by without file upload', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const form = new FormData()
    form.set('wordmark_text', 'MyCloud')
    form.set('hide_powered_by', 'true')

    const res = await app.request('/api/admin/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { wordmark_text: string; hide_powered_by: boolean }
    expect(body.wordmark_text).toBe('MyCloud')
    expect(body.hide_powered_by).toBe(true)

    // Verify GET reflects the update
    const getRes = await app.request('/api/branding')
    const getBody = (await getRes.json()) as { wordmark_text: string; hide_powered_by: boolean }
    expect(getBody.wordmark_text).toBe('MyCloud')
    expect(getBody.hide_powered_by).toBe(true)
  })

  it('uploads logo file to S3 and stores URL', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedPublicStorage(db)

    const logoFile = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' })
    const form = new FormData()
    form.set('logo', logoFile)

    const res = await app.request('/api/admin/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { logo_url: string }
    expect(body.logo_url).toBe('https://cdn.example.com/logo.png')
    expect(S3Service.prototype.putObject).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for invalid logo MIME type', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedPublicStorage(db)

    const badFile = new File(['data'], 'malware.exe', { type: 'application/octet-stream' })
    const form = new FormData()
    form.set('logo', badFile)

    const res = await app.request('/api/admin/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(400)
  })

  it('returns 413 for logo file exceeding 2MB', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedPublicStorage(db)

    // 2MB + 1 byte
    const bigData = new Uint8Array(2 * 1024 * 1024 + 1)
    const bigFile = new File([bigData], 'big.png', { type: 'image/png' })
    const form = new FormData()
    form.set('logo', bigFile)

    const res = await app.request('/api/admin/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(413)
  })

  it('returns 503 when no public storage is configured', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    // No storage seeded — selectStorage will throw

    const logoFile = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' })
    const form = new FormData()
    form.set('logo', logoFile)

    const res = await app.request('/api/admin/branding', { method: 'PUT', headers, body: form })
    expect(res.status).toBe(503)
  })
})

// ─── DELETE /api/admin/branding/:field ────────────────────────────────────────

describe('DELETE /api/admin/branding/:field', () => {
  it('returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/branding/logo', { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it('returns 402 without Pro feature', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/branding/logo', { method: 'DELETE', headers })
    expect(res.status).toBe(402)
  })

  it('resets a text field', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)
    await seedBrandingOption(db, 'branding_wordmark_text', 'MyCloud')

    const res = await app.request('/api/admin/branding/wordmark_text', { method: 'DELETE', headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reset: boolean }
    expect(body.reset).toBe(true)

    // Verify removed from DB
    const { systemOptions } = await import('../db/schema.js')
    const { eq } = await import('drizzle-orm')
    const rows = await db.select().from(systemOptions).where(eq(systemOptions.key, 'branding_wordmark_text'))
    expect(rows.length).toBe(0)
  })

  it('returns 400 for invalid field name', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedProLicense(db)

    const res = await app.request('/api/admin/branding/invalid_field', { method: 'DELETE', headers })
    expect(res.status).toBe(400)
  })
})
