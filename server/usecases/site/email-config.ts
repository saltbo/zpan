// The email-config resource usecase. Owns every business decision behind the
// /api/admin/email-config routes — reading the stored settings and masking
// secrets for display, flattening a validated config into the system_options
// key/value rows, and running a "send test email" probe — so the http handler
// only validates the request body, calls these functions, and serializes the
// result.
//
// Email config is stored as individual `email_*` rows in system_options; the
// EmailGateway reads them back (and decides whether email is "configured").
// All reads/writes go through the ports — nothing here touches infrastructure.

import { EMAIL_VERIFICATION_REQUIRED_OPTION_KEY, isEmailVerificationRequired } from '../../domain/email-verification'
import type { Platform } from '../../platform/interface'
import {
  type AppError,
  badRequest,
  type EmailConfig,
  type EmailGateway,
  type EmailProvider,
  type SmtpConfig,
  type SystemOptionsRepo,
} from '../ports'

export type EmailConfigDeps = {
  email: EmailGateway
  systemOptions: SystemOptionsRepo
}

// The validated request body the http layer hands to saveEmailConfig — the same
// discriminated union the route's zod schema produces.
export type SaveEmailConfigInput =
  | { enabled: boolean; requireEmailVerification: boolean; provider: 'smtp'; from: string; smtp: SmtpConfig }
  | {
      enabled: boolean
      requireEmailVerification: boolean
      provider: 'http'
      from: string
      http: { url: string; apiKey: string }
    }
  | { enabled: boolean; requireEmailVerification: boolean; provider: 'cloudflare'; from: string }

// The GET response shape: the enabled flag plus either a secret-masked view of
// the stored config or `{ provider: null }` when no usable config exists.
export type MaskedEmailSettings = { enabled: boolean; requireEmailVerification: boolean } & (
  | Record<string, unknown>
  | { provider: null }
)

// A test send either succeeds or fails for a reportable reason (provider error,
// or email being disabled — the gateway throws for both). A failure becomes a 400
// carrying the gateway's message.
export type SendTestEmailOutcome = { ok: true } | { ok: false; error: AppError }

function maskSecret(value: string): string {
  if (value.length === 0) return ''
  return `****${value.slice(-4)}`
}

function maskConfig(config: EmailConfig): Record<string, unknown> {
  if (config.provider === 'smtp') {
    return {
      provider: config.provider,
      from: config.from,
      smtp: {
        host: config.smtp.host,
        port: config.smtp.port,
        user: config.smtp.user,
        pass: maskSecret(config.smtp.pass),
        secure: config.smtp.secure,
      },
    }
  }
  if (config.provider === 'cloudflare') {
    return {
      provider: config.provider,
      from: config.from,
    }
  }
  return {
    provider: config.provider,
    from: config.from,
    http: {
      url: config.http.url,
      apiKey: maskSecret(config.http.apiKey),
    },
  }
}

// Flatten a validated config into the `email_*` system-option rows. The first
// three rows are written for every provider; provider-specific rows follow.
function preserveMaskedSecret(input: string, existing: string | null): string {
  return existing !== null && input === maskSecret(existing) ? existing : input
}

function configEntries(input: SaveEmailConfigInput, existingSecret: string | null): [string, string][] {
  const entries: [string, string][] = [
    ['email_enabled', String(input.enabled)],
    [EMAIL_VERIFICATION_REQUIRED_OPTION_KEY, String(input.requireEmailVerification)],
    ['email_provider', input.provider],
    ['email_from', input.from],
  ]
  if (input.provider === 'smtp') {
    entries.push(
      ['email_smtp_host', input.smtp.host],
      ['email_smtp_port', String(input.smtp.port)],
      ['email_smtp_user', input.smtp.user],
      ['email_smtp_pass', preserveMaskedSecret(input.smtp.pass, existingSecret)],
      ['email_smtp_secure', String(input.smtp.secure)],
    )
  } else if (input.provider === 'http') {
    entries.push(
      ['email_http_url', input.http.url],
      ['email_http_api_key', preserveMaskedSecret(input.http.apiKey, existingSecret)],
    )
  }
  return entries
}

export async function getEmailConfig(
  deps: Pick<EmailConfigDeps, 'email' | 'systemOptions'>,
  platform: Platform,
): Promise<MaskedEmailSettings> {
  const [settings, requiredValue] = await Promise.all([
    deps.email.getSettings(platform),
    deps.systemOptions.getValue(EMAIL_VERIFICATION_REQUIRED_OPTION_KEY),
  ])
  return {
    enabled: settings.enabled,
    requireEmailVerification: isEmailVerificationRequired(requiredValue),
    ...(settings.config ? maskConfig(settings.config) : { provider: null }),
  }
}

export async function saveEmailConfig(
  deps: Pick<EmailConfigDeps, 'systemOptions'>,
  input: SaveEmailConfigInput,
): Promise<void> {
  if (input.requireEmailVerification && !input.enabled) {
    throw badRequest('Email must be enabled before email verification can be required')
  }
  const existingSecret =
    input.provider === 'cloudflare'
      ? null
      : await deps.systemOptions.getValue(input.provider === 'smtp' ? 'email_smtp_pass' : 'email_http_api_key')
  await deps.systemOptions.setMany(configEntries(input, existingSecret).map(([key, value]) => ({ key, value })))
}

export async function sendTestEmail(
  deps: Pick<EmailConfigDeps, 'email'>,
  platform: Platform,
  to: string,
): Promise<SendTestEmailOutcome> {
  try {
    await deps.email.send(platform, {
      to,
      subject: 'ZPan Test Email',
      html: '<h1>Test Email</h1><p>Your email configuration is working correctly.</p>',
    })
    return { ok: true }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return { ok: false, error: badRequest(message) }
  }
}

// Re-exported so callers/tests can name the provider literal without reaching
// into ./ports — keeps the resource's surface self-contained.
export type { EmailProvider }
