import { like } from 'drizzle-orm'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

export interface EmailMessage {
  to: string
  subject: string
  html: string
}

export type EmailProvider = 'smtp' | 'http'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
  secure: boolean
}

export interface HttpConfig {
  url: string
  apiKey: string
}

export type EmailConfig =
  | { provider: 'smtp'; from: string; smtp: SmtpConfig }
  | { provider: 'http'; from: string; http: HttpConfig }

async function loadEmailOptions(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(like(systemOptions.key, 'email_%'))
  return new Map(rows.map((r) => [r.key, r.value]))
}

export async function getEmailConfig(db: Database): Promise<EmailConfig> {
  const opts = await loadEmailOptions(db)

  const provider = opts.get('email_provider')
  if (!provider) throw new Error('Email provider not configured: set email_provider in system options')
  if (provider !== 'smtp' && provider !== 'http') throw new Error(`Unknown email provider: ${provider}`)

  const from = opts.get('email_from')
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

  const url = opts.get('email_http_url')
  const apiKey = opts.get('email_http_api_key')
  if (!url || !apiKey) throw new Error('HTTP email url and api_key are required')
  return { provider, from, http: { url, apiKey } }
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

export async function sendEmail(db: Database, message: EmailMessage): Promise<void> {
  const config = await getEmailConfig(db)
  if (config.provider === 'smtp') return sendViaSmtp(config.from, config.smtp, message)
  return sendViaHttp(config.from, config.http, message)
}
