import { eq } from 'drizzle-orm'
import { SignupMode } from '../../shared/constants'
import { systemOptions } from '../db/schema'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import type { Database } from '../platform/interface'

/**
 * Returns the effective signup mode.
 *
 * Rule: `open` requires the `open_registration` Pro feature. Without it the
 * effective mode falls back to `invite-only`. All other stored values
 * (invite_only, closed) are returned unchanged. Unknown/empty values retain
 * the existing default-to-open behaviour and are not subject to the Pro check.
 */
export async function getEffectiveSignupMode(db: Database): Promise<SignupMode> {
  const rows = await db
    .select({ value: systemOptions.value })
    .from(systemOptions)
    .where(eq(systemOptions.key, 'auth_signup_mode'))
  const raw = rows[0]?.value

  if (raw === SignupMode.INVITE_ONLY || raw === SignupMode.CLOSED) return raw
  if (raw !== SignupMode.OPEN) return SignupMode.OPEN // unknown/empty → open (existing behaviour)

  // Stored value is explicitly 'open' — gate behind Pro feature
  const state = await loadBindingState(db)
  return hasFeature('open_registration', state) ? SignupMode.OPEN : SignupMode.INVITE_ONLY
}
