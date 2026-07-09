import type { ProFeature } from '@shared/types'
import { ProUpgradePrompt } from './ProUpgradePrompt'

const FEATURE_LABELS: Record<ProFeature, string> = {
  white_label: 'white-label branding',
  open_registration: 'open registration',
  teams_unlimited: 'unlimited teams',
  storages_unlimited: 'unlimited storages',
  social_login_unlimited: 'unlimited social logins',
  downloaders_unlimited: 'unlimited downloaders',
  audit_log: 'audit logs',
  quota_store: 'storage quota store',
  site_announcements: 'site announcements',
  analytics: 'analytics',
}

export interface UpgradeHintProps {
  feature: ProFeature
  title?: string
  description?: string
  actionLabel?: string
}

export function UpgradeHint({ feature, title, description, actionLabel }: UpgradeHintProps) {
  const featureLabel = FEATURE_LABELS[feature] ?? feature
  const displayName = featureLabel.charAt(0).toUpperCase() + featureLabel.slice(1)

  return (
    <div data-slot="upgrade-hint">
      <ProUpgradePrompt
        title={title ?? 'Unlock with ZPan Pro'}
        description={description ?? `${displayName} is a Pro feature. Upgrade your plan to access it.`}
        actionLabel={actionLabel ?? 'Upgrade to Pro'}
      />
    </div>
  )
}
