import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../../platform/interface'
import type { EmailConfig, EmailGateway, EmailMessage, EmailSettings, SystemOptionsRepo } from '../ports'
import {
  type EmailConfigDeps,
  getEmailConfig,
  type SaveEmailConfigInput,
  saveEmailConfig,
  sendTestEmail,
} from './email-config'

// The usecase never inspects the platform — it only forwards it to the gateway,
// which is a fake here — so a bare object stands in.
const platform = {} as Platform

const smtpSettings: EmailSettings = {
  enabled: true,
  config: {
    provider: 'smtp',
    from: 'no-reply@example.com',
    smtp: { host: 'smtp.example.com', port: 587, user: 'user@example.com', pass: 'supersecret', secure: true },
  },
}

const httpSettings: EmailSettings = {
  enabled: true,
  config: {
    provider: 'http',
    from: 'no-reply@example.com',
    http: { url: 'https://api.mail.example.com/send', apiKey: 'my-secret-key' },
  },
}

const cloudflareSettings: EmailSettings = {
  enabled: true,
  config: { provider: 'cloudflare', from: 'no-reply@zpan.space' },
}

function makeDeps(overrides: { email?: Partial<EmailGateway>; systemOptions?: Partial<SystemOptionsRepo> } = {}) {
  const send = vi.fn(async (_p: Platform, _m: EmailMessage) => {})
  const setMany = vi.fn(async (_entries: Array<{ key: string; value: string }>) => {})
  const getSettings = vi.fn(async (_p: Platform): Promise<EmailSettings> => ({ enabled: false, config: null }))
  const email: EmailGateway = {
    getConfig: async () => ({}) as EmailConfig,
    getSettings,
    isConfigured: async () => false,
    send,
    ...overrides.email,
  }
  const systemOptions: SystemOptionsRepo = {
    get: async () => null,
    getValue: async () => null,
    getMany: async () => [],
    listByPrefix: async () => [],
    set: async () => {},
    setMany,
    delete: async () => {},
    ...overrides.systemOptions,
  }
  const deps: EmailConfigDeps = { email, systemOptions }
  return { deps, send, setMany, getSettings }
}

beforeEach(() => vi.clearAllMocks())

describe('email-config usecase', () => {
  describe('getEmailConfig', () => {
    it('returns the disabled empty state when no config exists', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => ({ enabled: false, config: null }) } })
      expect(await getEmailConfig(deps, platform)).toEqual({
        enabled: false,
        requireEmailVerification: false,
        provider: null,
      })
    })

    it('returns enabled with provider null when config is incomplete', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => ({ enabled: true, config: null }) } })
      expect(await getEmailConfig(deps, platform)).toEqual({
        enabled: true,
        requireEmailVerification: false,
        provider: null,
      })
    })

    it('masks the SMTP password, keeping the last 4 chars', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => smtpSettings } })
      const out = await getEmailConfig(deps, platform)
      expect(out).toEqual({
        enabled: true,
        requireEmailVerification: false,
        provider: 'smtp',
        from: 'no-reply@example.com',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          user: 'user@example.com',
          pass: '****cret',
          secure: true,
        },
      })
    })

    it('masks the HTTP api key', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => httpSettings } })
      const out = await getEmailConfig(deps, platform)
      expect(out).toEqual({
        enabled: true,
        requireEmailVerification: false,
        provider: 'http',
        from: 'no-reply@example.com',
        http: { url: 'https://api.mail.example.com/send', apiKey: '****-key' },
      })
    })

    it('returns the Cloudflare config without any secret fields', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => cloudflareSettings } })
      expect(await getEmailConfig(deps, platform)).toEqual({
        enabled: true,
        requireEmailVerification: false,
        provider: 'cloudflare',
        from: 'no-reply@zpan.space',
      })
    })

    it('masks an empty secret to an empty string', async () => {
      const settings: EmailSettings = {
        enabled: true,
        config: {
          provider: 'smtp',
          from: 'no-reply@example.com',
          smtp: { host: 'mail.example.com', port: 465, user: '', pass: '', secure: false },
        },
      }
      const { deps } = makeDeps({ email: { getSettings: async () => settings } })
      const out = (await getEmailConfig(deps, platform)) as unknown as { smtp: { pass: string } }
      expect(out.smtp.pass).toBe('')
    })

    it('returns the stored email verification policy', async () => {
      const { deps } = makeDeps({
        email: { getSettings: async () => cloudflareSettings },
        systemOptions: { getValue: async () => 'true' },
      })
      expect(await getEmailConfig(deps, platform)).toMatchObject({ requireEmailVerification: true })
    })
  })

  describe('saveEmailConfig', () => {
    it('writes the SMTP option rows atomically', async () => {
      const { deps, setMany } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: true,
        requireEmailVerification: true,
        provider: 'smtp',
        from: 'sender@example.com',
        smtp: { host: 'mail.example.com', port: 465, user: 'u', pass: 'p', secure: false },
      }
      await saveEmailConfig(deps, input)
      expect(setMany).toHaveBeenCalledWith([
        { key: 'email_enabled', value: 'true' },
        { key: 'auth_require_email_verification', value: 'true' },
        { key: 'email_provider', value: 'smtp' },
        { key: 'email_from', value: 'sender@example.com' },
        { key: 'email_smtp_host', value: 'mail.example.com' },
        { key: 'email_smtp_port', value: '465' },
        { key: 'email_smtp_user', value: 'u' },
        { key: 'email_smtp_pass', value: 'p' },
        { key: 'email_smtp_secure', value: 'false' },
      ])
    })

    it('writes the HTTP option rows', async () => {
      const { deps, setMany } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: true,
        requireEmailVerification: false,
        provider: 'http',
        from: 'http-from@example.com',
        http: { url: 'https://api.sendgrid.com/v3/mail/send', apiKey: 'SG.key12345' },
      }
      await saveEmailConfig(deps, input)
      expect(setMany).toHaveBeenCalledWith([
        { key: 'email_enabled', value: 'true' },
        { key: 'auth_require_email_verification', value: 'false' },
        { key: 'email_provider', value: 'http' },
        { key: 'email_from', value: 'http-from@example.com' },
        { key: 'email_http_url', value: 'https://api.sendgrid.com/v3/mail/send' },
        { key: 'email_http_api_key', value: 'SG.key12345' },
      ])
    })

    it('preserves the stored SMTP password when the masked value is submitted unchanged', async () => {
      const { deps, setMany } = makeDeps({ systemOptions: { getValue: async () => 'supersecret' } })
      await saveEmailConfig(deps, {
        enabled: true,
        requireEmailVerification: true,
        provider: 'smtp',
        from: 'sender@example.com',
        smtp: { host: 'mail.example.com', port: 587, user: 'u', pass: '****cret', secure: true },
      })

      expect(setMany).toHaveBeenCalledWith(expect.arrayContaining([{ key: 'email_smtp_pass', value: 'supersecret' }]))
    })

    it('preserves the stored HTTP API key when the masked value is submitted unchanged', async () => {
      const { deps, setMany } = makeDeps({ systemOptions: { getValue: async () => 'my-secret-key' } })
      await saveEmailConfig(deps, {
        enabled: true,
        requireEmailVerification: true,
        provider: 'http',
        from: 'sender@example.com',
        http: { url: 'https://api.mail.example.com/send', apiKey: '****-key' },
      })

      expect(setMany).toHaveBeenCalledWith(
        expect.arrayContaining([{ key: 'email_http_api_key', value: 'my-secret-key' }]),
      )
    })

    it('writes only the three shared rows for Cloudflare', async () => {
      const { deps, setMany } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: true,
        requireEmailVerification: false,
        provider: 'cloudflare',
        from: 'no-reply@zpan.space',
      }
      await saveEmailConfig(deps, input)
      expect(setMany).toHaveBeenCalledWith([
        { key: 'email_enabled', value: 'true' },
        { key: 'auth_require_email_verification', value: 'false' },
        { key: 'email_provider', value: 'cloudflare' },
        { key: 'email_from', value: 'no-reply@zpan.space' },
      ])
    })

    it('persists a disabled state even when a provider config is given', async () => {
      const { deps, setMany } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: false,
        requireEmailVerification: false,
        provider: 'smtp',
        from: 'sender@example.com',
        smtp: { host: 'mail.example.com', port: 587, user: '', pass: '', secure: true },
      }
      await saveEmailConfig(deps, input)
      expect(setMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          { key: 'email_enabled', value: 'false' },
          { key: 'email_provider', value: 'smtp' },
        ]),
      )
    })

    it('rejects required verification when email sending is disabled', async () => {
      const { deps, setMany } = makeDeps()
      await expect(
        saveEmailConfig(deps, {
          enabled: false,
          requireEmailVerification: true,
          provider: 'cloudflare',
          from: 'no-reply@zpan.space',
        }),
      ).rejects.toMatchObject({ httpStatus: 400 })
      expect(setMany).not.toHaveBeenCalled()
    })
  })

  describe('sendTestEmail', () => {
    it('sends the canned test message and reports success', async () => {
      const send = vi.fn(async () => {})
      const { deps } = makeDeps({ email: { send } })
      const out = await sendTestEmail(deps, platform, 'recipient@example.com')
      expect(out).toEqual({ ok: true })
      expect(send).toHaveBeenCalledWith(platform, {
        to: 'recipient@example.com',
        subject: 'ZPan Test Email',
        html: '<h1>Test Email</h1><p>Your email configuration is working correctly.</p>',
      })
    })

    it('reports a 400 error with the error message when the gateway throws', async () => {
      const send = vi.fn(async () => {
        throw new Error('Email is disabled')
      })
      const { deps } = makeDeps({ email: { send } })
      const out = await sendTestEmail(deps, platform, 'recipient@example.com')
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Email is disabled')
    })

    it('falls back to "Unknown error" when a non-Error is thrown', async () => {
      const send = vi.fn(async () => {
        throw 'boom'
      })
      const { deps } = makeDeps({ email: { send } })
      const out = await sendTestEmail(deps, platform, 'recipient@example.com')
      expect(out.ok).toBe(false)
      if (out.ok) throw new Error('expected failure')
      expect(out.error.httpStatus).toBe(400)
      expect(out.error.message).toBe('Unknown error')
    })
  })
})
