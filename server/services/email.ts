import { like } from 'drizzle-orm'
import { systemOptions } from '../db/schema'
import type { Database, Platform } from '../platform/interface'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text?: string
}

export type EmailProvider = 'smtp' | 'http' | 'cloudflare'

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

export interface CloudflareEmailBinding {
  send(message: {
    to: string | string[]
    from: string | { email: string; name: string }
    subject: string
    html?: string
    text?: string
  }): Promise<{ messageId: string }>
}

export type EmailConfig =
  | { provider: 'smtp'; from: string; smtp: SmtpConfig }
  | { provider: 'http'; from: string; http: HttpConfig }
  | { provider: 'cloudflare'; from: string }

export interface EmailSettings {
  enabled: boolean
  config: EmailConfig | null
}

export type EmailSource = Database | Platform

const CLOUDFLARE_EMAIL_BINDING = 'EMAIL'

function getDb(source: EmailSource): Database {
  return 'db' in source ? source.db : source
}

function getPlatform(source: EmailSource): Platform | undefined {
  return 'db' in source ? source : undefined
}

function getCloudflareBinding(platform: Platform | undefined): CloudflareEmailBinding | undefined {
  return platform?.getBinding<CloudflareEmailBinding>(CLOUDFLARE_EMAIL_BINDING)
}

async function loadEmailOptions(db: Database): Promise<Map<string, string>> {
  const rows = await db
    .select({ key: systemOptions.key, value: systemOptions.value })
    .from(systemOptions)
    .where(like(systemOptions.key, 'email_%'))
  return new Map(rows.map((r) => [r.key, r.value]))
}

function isEmailEnabledOption(opts: Map<string, string>): boolean {
  return opts.get('email_enabled') === 'true'
}

export async function getEmailConfig(source: EmailSource): Promise<EmailConfig> {
  const db = getDb(source)
  const platform = getPlatform(source)
  const opts = await loadEmailOptions(db)

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

export async function getEmailSettings(source: EmailSource): Promise<EmailSettings> {
  const db = getDb(source)
  const opts = await loadEmailOptions(db)
  const enabled = isEmailEnabledOption(opts)

  try {
    const config = await getEmailConfig(source)
    return { enabled, config }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Email provider not configured') || error.message.includes('Email sender not configured'))
    ) {
      return { enabled, config: null }
    }
    throw error
  }
}

export async function isEmailConfigured(source: EmailSource): Promise<boolean> {
  const db = getDb(source)
  const opts = await loadEmailOptions(db)
  if (!isEmailEnabledOption(opts)) return false

  try {
    await getEmailConfig(source)
    return true
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Email provider not configured') || error.message.includes('Email sender not configured'))
    ) {
      return false
    }
    throw error
  }
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

async function sendViaCloudflare(platform: Platform | undefined, from: string, message: EmailMessage): Promise<void> {
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

export async function sendEmail(source: EmailSource, message: EmailMessage): Promise<void> {
  if (!(await isEmailConfigured(source))) {
    throw new Error('Email is disabled')
  }
  const config = await getEmailConfig(source)
  if (config.provider === 'smtp') return sendViaSmtp(config.from, config.smtp, message)
  if (config.provider === 'http') return sendViaHttp(config.from, config.http, message)
  return sendViaCloudflare(getPlatform(source), config.from, message)
}
