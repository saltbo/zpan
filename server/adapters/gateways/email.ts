import type { Platform } from '../../platform/interface'
import type {
  EmailConfig,
  EmailGateway,
  EmailMessage,
  EmailSettings,
  HttpConfig,
  SmtpConfig,
  SystemOptionsRepo,
} from '../../usecases/ports'

interface CloudflareEmailBinding {
  send(message: {
    to: string | string[]
    from: string | { email: string; name: string }
    subject: string
    html?: string
    text?: string
  }): Promise<{ messageId: string }>
}

const CLOUDFLARE_EMAIL_BINDING = 'EMAIL'

function getCloudflareBinding(platform: Platform): CloudflareEmailBinding | undefined {
  return platform.getBinding<CloudflareEmailBinding>(CLOUDFLARE_EMAIL_BINDING)
}

function isConfigError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Email provider not configured') || error.message.includes('Email sender not configured'))
  )
}

async function sendViaSmtp(from: string, smtp: SmtpConfig, message: EmailMessage): Promise<void> {
  // Dynamic import: nodemailer uses Node.js net/tls modules unavailable on CF Workers.
  // This ensures the module is only loaded when SMTP is actually used (Node.js target).
  const { createTransport } = await import('nodemailer')
  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  })
  await transporter.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    html: message.html,
  })
}

async function sendViaHttp(from: string, http: HttpConfig, message: EmailMessage): Promise<void> {
  const res = await fetch(http.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${http.apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP email API error (${res.status}): ${body}`)
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function sendViaCloudflare(platform: Platform, from: string, message: EmailMessage): Promise<void> {
  const binding = getCloudflareBinding(platform)
  if (!binding) throw new Error(`Cloudflare email binding "${CLOUDFLARE_EMAIL_BINDING}" is not configured`)
  await binding.send({
    to: message.to,
    from,
    subject: message.subject,
    html: message.html,
    text: message.text ?? stripHtml(message.html),
  })
}

export function createEmailGateway(systemOptions: SystemOptionsRepo): EmailGateway {
  async function loadOptions(): Promise<Map<string, string>> {
    const rows = await systemOptions.listByPrefix('email_')
    return new Map(rows.map((r) => [r.key, r.value]))
  }

  async function getConfig(platform: Platform): Promise<EmailConfig> {
    const opts = await loadOptions()

    const provider = opts.get('email_provider')
    const from = opts.get('email_from')
    if (!provider) {
      throw new Error('Email provider not configured: set email_provider in system options')
    }
    if (provider !== 'smtp' && provider !== 'http' && provider !== 'cloudflare') {
      throw new Error(`Unknown email provider: ${provider}`)
    }
    if (!from) throw new Error('Email sender not configured: set email_from in system options')

    if (provider === 'smtp') {
      const host = opts.get('email_smtp_host')
      const port = opts.get('email_smtp_port')
      if (!host || !port) throw new Error('SMTP host and port are required')
      return {
        provider,
        from,
        smtp: {
          host,
          port: Number(port),
          user: opts.get('email_smtp_user') ?? '',
          pass: opts.get('email_smtp_pass') ?? '',
          secure: opts.get('email_smtp_secure') === 'true',
        },
      }
    }

    if (provider === 'cloudflare') {
      if (!getCloudflareBinding(platform)) {
        throw new Error(`Cloudflare email binding "${CLOUDFLARE_EMAIL_BINDING}" is not configured`)
      }
      return { provider, from }
    }
    const url = opts.get('email_http_url')
    const apiKey = opts.get('email_http_api_key')
    if (!url || !apiKey) throw new Error('HTTP email url and api_key are required')
    return { provider, from, http: { url, apiKey } }
  }

  async function isEnabled(): Promise<boolean> {
    const opts = await loadOptions()
    return opts.get('email_enabled') === 'true'
  }

  async function isConfigured(platform: Platform): Promise<boolean> {
    if (!(await isEnabled())) return false
    try {
      await getConfig(platform)
      return true
    } catch (error) {
      if (isConfigError(error)) return false
      throw error
    }
  }

  return {
    getConfig,
    isConfigured,

    async getSettings(platform: Platform): Promise<EmailSettings> {
      const enabled = await isEnabled()
      try {
        const config = await getConfig(platform)
        return { enabled, config }
      } catch (error) {
        if (isConfigError(error)) return { enabled, config: null }
        throw error
      }
    },

    async send(platform: Platform, message: EmailMessage): Promise<void> {
      if (!(await isConfigured(platform))) throw new Error('Email is disabled')
      const config = await getConfig(platform)
      if (config.provider === 'smtp') return sendViaSmtp(config.from, config.smtp, message)
      if (config.provider === 'http') return sendViaHttp(config.from, config.http, message)
      return sendViaCloudflare(platform, config.from, message)
    },
  }
}
