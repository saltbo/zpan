export type { ProFeature } from '../feature-registry'

export interface LicenseAssertion {
  type: 'zpan.license'
  issuer: string
  subject: string
  accountId: string
  instanceId: string
  edition: 'pro'
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
  edition?: 'pro'
  license_valid_until?: number
  certificate_expires_at?: number
  last_refresh_at?: number
  last_refresh_error?: string
}
