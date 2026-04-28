import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../db/schema.js'
import { adminHeaders, authedHeaders, createTestApp } from '../test/setup.js'

async function seedSmtpConfig(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await db.insert(schema.systemOptions).values([
    { key: 'email_enabled', value: 'true' },
    { key: 'email_provider', value: 'smtp' },
    { key: 'email_from', value: 'no-reply@example.com' },
    { key: 'email_smtp_host', value: 'smtp.example.com' },
    { key: 'email_smtp_port', value: '587' },
    { key: 'email_smtp_user', value: 'user@example.com' },
    { key: 'email_smtp_pass', value: 'supersecret' },
    { key: 'email_smtp_secure', value: 'true' },
  ])
}

async function seedHttpConfig(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await db.insert(schema.systemOptions).values([
    { key: 'email_enabled', value: 'true' },
    { key: 'email_provider', value: 'http' },
    { key: 'email_from', value: 'no-reply@example.com' },
    { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
    { key: 'email_http_api_key', value: 'my-secret-key' },
  ])
}

async function seedCloudflareConfig(db: Awaited<ReturnType<typeof createTestApp>>['db']) {
  await db.insert(schema.systemOptions).values([
    { key: 'email_enabled', value: 'true' },
    { key: 'email_provider', value: 'cloudflare' },
    { key: 'email_from', value: 'no-reply@zpan.space' },
  ])
}

describe('Admin Email Config API — auth', () => {
  it('GET returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/email-config')
    expect(res.status).toBe(401)
  })

  it('GET returns 403 for non-admin user', async () => {
    const { app } = await createTestApp()
    await authedHeaders(app, 'admin@example.com')
    await authedHeaders(app, 'regular@example.com')
    const signInRes = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regular@example.com', password: 'password123456' }),
    })
    const freshHeaders = { Cookie: signInRes.headers.getSetCookie().join('; ') }
    const res = await app.request('/api/admin/email-config', { headers: freshHeaders })
    expect(res.status).toBe(403)
  })

  it('PUT returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, provider: 'smtp', from: 'a@b.com' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /test returns 401 without auth', async () => {
    const { app } = await createTestApp()
    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'a@b.com' }),
    })
    expect(res.status).toBe(401)
  })
})

describe('Admin Email Config API — GET', () => {
  it('returns disabled empty state when no config exists', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)
    const res = await app.request('/api/admin/email-config', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toEqual({ enabled: false, provider: null })
  })

  it('returns masked SMTP config after SMTP config is saved', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedSmtpConfig(db)

    const res = await app.request('/api/admin/email-config', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.enabled).toBe(true)
    expect(body.provider).toBe('smtp')
    expect(body.from).toBe('no-reply@example.com')
    const smtp = body.smtp as Record<string, unknown>
    expect(smtp.host).toBe('smtp.example.com')
    expect(smtp.port).toBe(587)
    expect(smtp.user).toBe('user@example.com')
    expect(smtp.secure).toBe(true)
    // Password must be masked — last 4 chars visible, rest are asterisks
    expect(smtp.pass).not.toBe('supersecret')
    expect(String(smtp.pass).endsWith('cret')).toBe(true)
    expect(String(smtp.pass)).toMatch(/^\*+cret$/)
  })

  it('returns masked HTTP config after HTTP config is saved', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedHttpConfig(db)

    const res = await app.request('/api/admin/email-config', { headers })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.enabled).toBe(true)
    expect(body.provider).toBe('http')
    expect(body.from).toBe('no-reply@example.com')
    const http = body.http as Record<string, unknown>
    expect(http.url).toBe('https://api.mail.example.com/send')
    // apiKey must be masked
    expect(http.apiKey).not.toBe('my-secret-key')
    expect(String(http.apiKey).endsWith('-key')).toBe(true)
    expect(String(http.apiKey)).toMatch(/^\*+-key$/)
  })

  it('returns Cloudflare config from EMAIL binding when enabled and email_from exist with no provider set', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg_123' })
    const { app, db } = await createTestApp({}, { EMAIL: { send: sendMock } })
    await db.insert(schema.systemOptions).values([
      { key: 'email_enabled', value: 'true' },
      { key: 'email_from', value: 'no-reply@zpan.space' },
    ])
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config', { headers })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      enabled: true,
      provider: 'cloudflare',
      from: 'no-reply@zpan.space',
    })
  })
})

describe('Admin Email Config API — PUT', () => {
  it('saves SMTP config and returns success', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'smtp',
        enabled: true,
        from: 'no-reply@example.com',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          user: 'user@example.com',
          pass: 'secret',
          secure: true,
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('persists SMTP config so GET reflects the saved values', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'smtp',
        enabled: true,
        from: 'sender@example.com',
        smtp: {
          host: 'mail.example.com',
          port: 465,
          user: '',
          pass: '',
          secure: false,
        },
      }),
    })

    const res = await app.request('/api/admin/email-config', { headers })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.provider).toBe('smtp')
    expect(body.from).toBe('sender@example.com')
    const smtp = body.smtp as Record<string, unknown>
    expect(smtp.host).toBe('mail.example.com')
    expect(smtp.port).toBe(465)
  })

  it('saves HTTP config and returns success', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'http',
        enabled: true,
        from: 'no-reply@example.com',
        http: {
          url: 'https://api.mail.example.com/send',
          apiKey: 'my-api-key',
        },
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('persists HTTP config so GET reflects the saved values', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'http',
        enabled: true,
        from: 'http-from@example.com',
        http: {
          url: 'https://api.sendgrid.com/v3/mail/send',
          apiKey: 'SG.key12345',
        },
      }),
    })

    const res = await app.request('/api/admin/email-config', { headers })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.provider).toBe('http')
    expect(body.from).toBe('http-from@example.com')
    const http = body.http as Record<string, unknown>
    expect(http.url).toBe('https://api.sendgrid.com/v3/mail/send')
  })

  it('returns 400 for invalid provider value', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, provider: 'sendgrid', from: 'a@b.com' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid from email', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, provider: 'smtp', from: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })

  it('updates existing config when PUT is called a second time', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'smtp',
        enabled: true,
        from: 'first@example.com',
        smtp: { host: 'first.smtp.com', port: 25, user: '', pass: '', secure: false },
      }),
    })

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'smtp',
        enabled: true,
        from: 'second@example.com',
        smtp: { host: 'second.smtp.com', port: 587, user: '', pass: '', secure: true },
      }),
    })

    const res = await app.request('/api/admin/email-config', { headers })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.from).toBe('second@example.com')
    const smtp = body.smtp as Record<string, unknown>
    expect(smtp.host).toBe('second.smtp.com')
    expect(smtp.port).toBe(587)
  })

  it('saves Cloudflare config and returns success', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'cloudflare',
        enabled: true,
        from: 'no-reply@zpan.space',
      }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true })
  })

  it('persists Cloudflare config so GET reflects the saved values', async () => {
    const { app } = await createTestApp({}, { EMAIL: { send: vi.fn() } })
    const headers = await adminHeaders(app)

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'cloudflare',
        enabled: true,
        from: 'no-reply@zpan.space',
      }),
    })

    const res = await app.request('/api/admin/email-config', { headers })
    await expect(res.json()).resolves.toEqual({
      enabled: true,
      provider: 'cloudflare',
      from: 'no-reply@zpan.space',
    })
  })

  it('persists disabled state even when provider config exists', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
        provider: 'smtp',
        from: 'sender@example.com',
        smtp: { host: 'mail.example.com', port: 587, user: '', pass: '', secure: true },
      }),
    })

    const res = await app.request('/api/admin/email-config', { headers })
    const body = (await res.json()) as Record<string, unknown>
    expect(body.enabled).toBe(false)
    expect(body.provider).toBe('smtp')
  })
})

describe('Admin Email Config API — POST /test', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns success when sendEmail succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedHttpConfig(db)

    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'recipient@example.com' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
  })

  it('returns 400 with error message when sendEmail fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('Internal Server Error'),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedHttpConfig(db)

    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'recipient@example.com' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(typeof body.error).toBe('string')
  })

  it('returns 400 when no email config is set', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'recipient@example.com' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(String(body.error)).toContain('Email is disabled')
  })

  it('returns 400 when email is disabled even if provider config exists', async () => {
    const { app } = await createTestApp()
    const headers = await adminHeaders(app)

    await app.request('/api/admin/email-config', {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
        provider: 'http',
        from: 'no-reply@example.com',
        http: { url: 'https://api.mail.example.com/send', apiKey: 'key' },
      }),
    })

    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'recipient@example.com' }),
    })

    expect(res.status).toBe(400)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(String(body.error)).toContain('Email is disabled')
  })

  it('returns 400 for invalid to email', async () => {
    const { app, db } = await createTestApp()
    const headers = await adminHeaders(app)
    await seedSmtpConfig(db)

    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'not-an-email' }),
    })
    expect(res.status).toBe(400)
  })

  it('uses Cloudflare EMAIL binding when provider is cloudflare', async () => {
    const sendMock = vi.fn().mockResolvedValue({ messageId: 'msg_123' })
    const { app, db } = await createTestApp({}, { EMAIL: { send: sendMock } })
    const headers = await adminHeaders(app)
    await seedCloudflareConfig(db)

    const res = await app.request('/api/admin/email-config/test-messages', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'recipient@example.com' }),
    })

    expect(res.status).toBe(200)
    expect(sendMock).toHaveBeenCalledOnce()
  })
})
