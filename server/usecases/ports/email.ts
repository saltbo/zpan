import type { Platform } from '../../platform/interface'

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

export type EmailConfig =
  | { provider: 'smtp'; from: string; smtp: SmtpConfig }
  | { provider: 'http'; from: string; http: HttpConfig }
  | { provider: 'cloudflare'; from: string }

export interface EmailSettings {
  enabled: boolean
  config: EmailConfig | null
}

// Outbound transactional email. Config is read from system options; the
// Cloudflare provider also needs the platform's EMAIL binding, so the platform
// is passed per call rather than captured at construction.
export interface EmailGateway {
  getConfig(platform: Platform): Promise<EmailConfig>
  getSettings(platform: Platform): Promise<EmailSettings>
  isConfigured(platform: Platform): Promise<boolean>
  send(platform: Platform, message: EmailMessage): Promise<void>
}
