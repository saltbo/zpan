import { PRO_GATE_KEYS } from '@shared/feature-registry'
import type { BindingState, LicenseFeature } from '@shared/types'

const BUSINESS_ONLY_FEATURES = new Set<LicenseFeature>(['quota_store', 'site_announcements'])

export function effectiveFeatures(edition: BindingState['edition']): LicenseFeature[] {
  if (edition === 'pro') return PRO_GATE_KEYS.filter((feature) => !BUSINESS_ONLY_FEATURES.has(feature))
  if (edition === 'business') return [...PRO_GATE_KEYS]
  return []
}

export function hasFeature(feature: LicenseFeature, state: BindingState | null): boolean {
  return Boolean(feature && state?.bound && state.active && effectiveFeatures(state.edition).includes(feature))
}
