import { SignupMode } from '@shared/constants'
import { hasFeature } from '../domain/licensing'
import { loadBindingState } from './licensing'
import type { LicenseBindingRepo, SystemOptionsRepo } from './ports'

export type SignupModeDeps = { systemOptions: SystemOptionsRepo; licenseBinding: LicenseBindingRepo }

/**
 * Returns the effective signup mode.
 *
 * Rule: `open` requires the `open_registration` Pro feature. Without it the
 * effective mode falls back to `invite-only`. All other stored values
 * (invite_only, closed) are returned unchanged. Unknown/empty values retain
 * the existing default-to-open behaviour and are not subject to the Pro check.
 */
export async function getEffectiveSignupMode(deps: SignupModeDeps): Promise<SignupMode> {
  const raw = await deps.systemOptions.getValue('auth_signup_mode')

  if (raw === SignupMode.INVITE_ONLY || raw === SignupMode.CLOSED) return raw
  if (raw !== SignupMode.OPEN) return SignupMode.OPEN // unknown/empty → open (existing behaviour)

  // Stored value is explicitly 'open' — gate behind Pro feature
  const state = await loadBindingState({ licenseBinding: deps.licenseBinding })
  return hasFeature('open_registration', state) ? SignupMode.OPEN : SignupMode.INVITE_ONLY
}
