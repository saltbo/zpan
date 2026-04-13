import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../db/schema.js'
import { createTestApp } from '../test/setup.js'
import { getEmailConfig, sendEmail } from './email.js'

const sendMailMock = vi.fn()

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({ sendMail: sendMailMock })),
}))

describe('getEmailConfig', () => {
  it('throws when email_provider is not set', async () => {
    const { db } = createTestApp()
    await expect(getEmailConfig(db)).rejects.toThrow('Email provider not configured')
  })

  it('throws when email_from is not set', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values({ key: 'email_provider', value: 'smtp' })
    await expect(getEmailConfig(db)).rejects.toThrow('Email sender not configured')
  })

  it('throws when SMTP host is missing', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'smtp' },
      { key: 'email_from', value: 'no-reply@example.com' },
    ])
    await expect(getEmailConfig(db)).rejects.toThrow('SMTP host and port are required')
  })

  it('throws when SMTP port is missing', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'smtp' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_smtp_host', value: 'smtp.example.com' },
    ])
    await expect(getEmailConfig(db)).rejects.toThrow('SMTP host and port are required')
  })

  it('returns SMTP config when provider is smtp and all required options are set', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'smtp' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_smtp_host', value: 'smtp.example.com' },
      { key: 'email_smtp_port', value: '587' },
      { key: 'email_smtp_user', value: 'user@example.com' },
      { key: 'email_smtp_pass', value: 'secret' },
      { key: 'email_smtp_secure', value: 'true' },
    ])
    const config = await getEmailConfig(db)
    expect(config.provider).toBe('smtp')
    expect(config.from).toBe('no-reply@example.com')
    if (config.provider !== 'smtp') throw new Error('expected smtp')
    expect(config.smtp.host).toBe('smtp.example.com')
    expect(config.smtp.port).toBe(587)
    expect(config.smtp.user).toBe('user@example.com')
    expect(config.smtp.pass).toBe('secret')
    expect(config.smtp.secure).toBe(true)
  })

  it('returns SMTP config with secure=false when email_smtp_secure is not "true"', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'smtp' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_smtp_host', value: 'smtp.example.com' },
      { key: 'email_smtp_port', value: '25' },
    ])
    const config = await getEmailConfig(db)
    if (config.provider !== 'smtp') throw new Error('expected smtp')
    expect(config.smtp.secure).toBe(false)
    expect(config.smtp.user).toBe('')
    expect(config.smtp.pass).toBe('')
  })

  it('throws when HTTP url is missing', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
    ])
    await expect(getEmailConfig(db)).rejects.toThrow('HTTP email url and api_key are required')
  })

  it('throws when HTTP apiKey is missing', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
    ])
    await expect(getEmailConfig(db)).rejects.toThrow('HTTP email url and api_key are required')
  })

  it('returns HTTP config when provider is http and all required options are set', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
      { key: 'email_http_api_key', value: 'my-api-key' },
    ])
    const config = await getEmailConfig(db)
    expect(config.provider).toBe('http')
    expect(config.from).toBe('no-reply@example.com')
    if (config.provider !== 'http') throw new Error('expected http')
    expect(config.http.url).toBe('https://api.mail.example.com/send')
    expect(config.http.apiKey).toBe('my-api-key')
  })

  it('throws when provider is an unknown value', async () => {
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'unknown' },
      { key: 'email_from', value: 'no-reply@example.com' },
    ])
    await expect(getEmailConfig(db)).rejects.toThrow('Unknown email provider: unknown')
  })
})

describe('sendEmail — SMTP provider', () => {
  beforeEach(() => {
    sendMailMock.mockReset()
  })

  it('calls nodemailer sendMail with correct parameters', async () => {
    sendMailMock.mockResolvedValue({})
    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'smtp' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_smtp_host', value: 'smtp.example.com' },
      { key: 'email_smtp_port', value: '587' },
    ])

    await sendEmail(db, { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' })
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
    })
  })
})

describe('sendEmail — HTTP provider', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to the configured HTTP URL with correct headers and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
      { key: 'email_http_api_key', value: 'my-api-key' },
    ])

    await sendEmail(db, { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' })

    expect(fetchMock).toHaveBeenCalledWith('https://api.mail.example.com/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-api-key',
      },
      body: JSON.stringify({
        from: 'no-reply@example.com',
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      }),
    })
  })

  it('throws when HTTP email API returns a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue('Invalid recipient'),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { db } = createTestApp()
    await db.insert(schema.systemOptions).values([
      { key: 'email_provider', value: 'http' },
      { key: 'email_from', value: 'no-reply@example.com' },
      { key: 'email_http_url', value: 'https://api.mail.example.com/send' },
      { key: 'email_http_api_key', value: 'my-api-key' },
    ])

    await expect(sendEmail(db, { to: 'bad@example.com', subject: 'Hi', html: '<p>Hi</p>' })).rejects.toThrow(
      'HTTP email API error (422): Invalid recipient',
    )
  })
})
