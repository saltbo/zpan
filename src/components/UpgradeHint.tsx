import type { ProFeature } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { ProUpgradePrompt } from './ProUpgradePrompt'

export interface UpgradeHintProps {
  feature: ProFeature
  title?: string
  description?: string
  actionLabel?: string
}

// Default copy lives in the locale files: admin.upgrade.title/description/action
// and admin.upgrade.feature.<gateKey>, so callers that pass no props render in
// the active language. Callers with their own copy keep passing title,
// description and actionLabel.
export function UpgradeHint({ feature, title, description, actionLabel }: UpgradeHintProps) {
  const { t } = useTranslation()

  return (
    <div data-slot="upgrade-hint">
      <ProUpgradePrompt
        title={title ?? t('admin.upgrade.title')}
        description={description ?? t('admin.upgrade.description', { feature: t(`admin.upgrade.feature.${feature}`) })}
        actionLabel={actionLabel ?? t('admin.upgrade.action')}
      />
    </div>
  )
}
