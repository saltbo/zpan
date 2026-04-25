import type { ProFeature } from '../feature-registry'

export type { ProFeature } from '../feature-registry'

export interface LicenseEntitlement {
  account_id: string
  instance_id: string
  plan: 'community' | 'pro'
  features: ProFeature[]
  issued_at: string
  expires_at: string
}

export interface BindingState {
  bound: boolean
  account_email?: string
  plan?: 'community' | 'pro'
  features?: ProFeature[]
  expires_at?: number
  last_refresh_at?: number
  last_refresh_error?: string
}
