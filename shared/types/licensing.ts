import type { ProFeature } from '../feature-registry'

export type { ProFeature } from '../feature-registry'

export type LicenseEdition = 'pro' | 'business'
export type LicenseKind = 'owned' | 'subscription'

export interface LicenseAssertion {
  type: 'zpan.license'
  issuer: string
  subject: string
  accountId: string
  instanceId: string
  edition: LicenseEdition
  features?: ProFeature[]
  licenseId?: string
  licenseKind?: LicenseKind
  businessPlanCode?: string
  storeLimit?: number
  authorizedHosts: string[]
  licenseValidUntil: number
  issuedAt: number
  notBefore: number
  expiresAt: number
}

export interface BindingState {
  bound: boolean
  active?: boolean
  account_email?: string
  edition?: LicenseEdition
  features?: ProFeature[]
  license_id?: string
  license_kind?: LicenseKind
  business_plan_code?: string
  store_limit?: number
  license_valid_until?: number
  certificate_expires_at?: number
  last_refresh_at?: number
  last_refresh_error?: string
  cloud_dashboard_url?: string
}
