import { eq } from 'drizzle-orm'
import { CAPTCHA_ENABLED_KEY, CAPTCHA_SECRET_OPTION_KEY } from '../../shared/captcha'
import { systemOptions } from '../db/schema'
import type { Database } from '../platform/interface'

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

type TurnstileResponse = {
  success: boolean
}

export async function isCaptchaEnabled(db: Database): Promise<boolean> {
  const [row] = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, CAPTCHA_ENABLED_KEY))
  return row?.value === 'true'
}

export async function verifyCaptchaToken(db: Database, token: string | undefined, remoteIp?: string): Promise<boolean> {
  if (!(await isCaptchaEnabled(db))) return true
  if (!token) return false

  const [secretRow] = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, CAPTCHA_SECRET_OPTION_KEY))
  const secret = secretRow?.value
  if (!secret) throw new Error('Captcha is enabled but the Turnstile secret key is missing')

  const form = new FormData()
  form.set('secret', secret)
  form.set('response', token)
  if (remoteIp) form.set('remoteip', remoteIp)

  const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Captcha verification failed with HTTP ${res.status}`)
  const body = (await res.json()) as TurnstileResponse
  return body.success
}
