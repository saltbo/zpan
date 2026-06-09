import type { LicenseFeature } from '../feature-registry'

export type { LicenseFeature, ProFeature } from '../feature-registry'

export type LicenseEdition = 'pro' | 'business'

export interface LicenseAssertion {
  type: 'zpan.license'
  issuer: string
  subject: string
  accountId: string
  instanceId: string
  edition: LicenseEdition
  licenseId?: string
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
  features?: LicenseFeature[]
  license_id?: string
  license_valid_until?: number
  certificate_expires_at?: number
  last_refresh_at?: number
  last_refresh_error?: string
  cloud_dashboard_url?: string
}
