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
  const set = vi.fn(async (_k: string, _v: string, _public: boolean) => {})
  const getSettings = vi.fn(async (_p: Platform): Promise<EmailSettings> => ({ enabled: false, config: null }))
  const email: EmailGateway = {
    getConfig: async () => ({}) as EmailConfig,
    getSettings,
    isConfigured: async () => false,
    send,
    ...overrides.email,
  }
  const systemOptions: SystemOptionsRepo = {
    list: async () => [],
    listPublic: async () => [],
    get: async () => null,
    getValue: async () => null,
    listByKeyLike: async () => [],
    set,
    delete: async () => {},
    ...overrides.systemOptions,
  }
  const deps: EmailConfigDeps = { email, systemOptions }
  return { deps, send, set, getSettings }
}

beforeEach(() => vi.clearAllMocks())

describe('email-config usecase', () => {
  describe('getEmailConfig', () => {
    it('returns the disabled empty state when no config exists', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => ({ enabled: false, config: null }) } })
      expect(await getEmailConfig(deps, platform)).toEqual({ enabled: false, provider: null })
    })

    it('returns enabled with provider null when config is incomplete', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => ({ enabled: true, config: null }) } })
      expect(await getEmailConfig(deps, platform)).toEqual({ enabled: true, provider: null })
    })

    it('masks the SMTP password, keeping the last 4 chars', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => smtpSettings } })
      const out = await getEmailConfig(deps, platform)
      expect(out).toEqual({
        enabled: true,
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
        provider: 'http',
        from: 'no-reply@example.com',
        http: { url: 'https://api.mail.example.com/send', apiKey: '****-key' },
      })
    })

    it('returns the Cloudflare config without any secret fields', async () => {
      const { deps } = makeDeps({ email: { getSettings: async () => cloudflareSettings } })
      expect(await getEmailConfig(deps, platform)).toEqual({
        enabled: true,
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
  })

  describe('saveEmailConfig', () => {
    it('writes the SMTP option rows (each non-public)', async () => {
      const { deps, set } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: true,
        provider: 'smtp',
        from: 'sender@example.com',
        smtp: { host: 'mail.example.com', port: 465, user: 'u', pass: 'p', secure: false },
      }
      await saveEmailConfig(deps, input)
      expect(set.mock.calls).toEqual([
        ['email_enabled', 'true', false],
        ['email_provider', 'smtp', false],
        ['email_from', 'sender@example.com', false],
        ['email_smtp_host', 'mail.example.com', false],
        ['email_smtp_port', '465', false],
        ['email_smtp_user', 'u', false],
        ['email_smtp_pass', 'p', false],
        ['email_smtp_secure', 'false', false],
      ])
    })

    it('writes the HTTP option rows', async () => {
      const { deps, set } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: true,
        provider: 'http',
        from: 'http-from@example.com',
        http: { url: 'https://api.sendgrid.com/v3/mail/send', apiKey: 'SG.key12345' },
      }
      await saveEmailConfig(deps, input)
      expect(set.mock.calls).toEqual([
        ['email_enabled', 'true', false],
        ['email_provider', 'http', false],
        ['email_from', 'http-from@example.com', false],
        ['email_http_url', 'https://api.sendgrid.com/v3/mail/send', false],
        ['email_http_api_key', 'SG.key12345', false],
      ])
    })

    it('writes only the three shared rows for Cloudflare', async () => {
      const { deps, set } = makeDeps()
      const input: SaveEmailConfigInput = { enabled: true, provider: 'cloudflare', from: 'no-reply@zpan.space' }
      await saveEmailConfig(deps, input)
      expect(set.mock.calls).toEqual([
        ['email_enabled', 'true', false],
        ['email_provider', 'cloudflare', false],
        ['email_from', 'no-reply@zpan.space', false],
      ])
    })

    it('persists a disabled state even when a provider config is given', async () => {
      const { deps, set } = makeDeps()
      const input: SaveEmailConfigInput = {
        enabled: false,
        provider: 'smtp',
        from: 'sender@example.com',
        smtp: { host: 'mail.example.com', port: 587, user: '', pass: '', secure: true },
      }
      await saveEmailConfig(deps, input)
      expect(set).toHaveBeenCalledWith('email_enabled', 'false', false)
      expect(set).toHaveBeenCalledWith('email_provider', 'smtp', false)
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

    it('reports send_failed with the error message when the gateway throws', async () => {
      const send = vi.fn(async () => {
        throw new Error('Email is disabled')
      })
      const { deps } = makeDeps({ email: { send } })
      const out = await sendTestEmail(deps, platform, 'recipient@example.com')
      expect(out).toEqual({ ok: false, reason: 'send_failed', message: 'Email is disabled' })
    })

    it('falls back to "Unknown error" when a non-Error is thrown', async () => {
      const send = vi.fn(async () => {
        throw 'boom'
      })
      const { deps } = makeDeps({ email: { send } })
      const out = await sendTestEmail(deps, platform, 'recipient@example.com')
      expect(out).toEqual({ ok: false, reason: 'send_failed', message: 'Unknown error' })
    })
  })
})
