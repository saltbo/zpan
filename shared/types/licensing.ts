export type ProFeature = 'white_label' | 'open_registration' | 'teams_unlimited' | 'team_quotas'

export interface LicenseEntitlement {
  account_id: string
  instance_id: string
  plan: 'community' | 'pro'
  features: ProFeature[]
  issued_at: number
  expires_at: number
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
