import type { ProFeature } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/lib/auth-client'
import { ProUpgradePrompt } from './ProUpgradePrompt'

export interface UpgradeHintProps {
  feature: ProFeature
  title?: string
  description?: string
  actionLabel?: string
}

// Default copy lives in the locale files: admin.upgrade.* and
// admin.upgrade.feature.<gateKey>, so callers that pass no props render in the
// active language. Only an admin can open licensing (UX.md, Pro gating), so
// anyone else is told to ask the site's administrator instead of given a link.
export function UpgradeHint({ feature, title, description, actionLabel }: UpgradeHintProps) {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === 'admin'
  const featureLabel = t(`admin.upgrade.feature.${feature}`)

  return (
    <div data-slot="upgrade-hint">
      {isAdmin ? (
        <ProUpgradePrompt
          title={title ?? t('admin.upgrade.title')}
          description={description ?? t('admin.upgrade.description', { feature: featureLabel })}
          action={{ label: actionLabel ?? t('admin.upgrade.action'), href: '/admin/licensing' }}
        />
      ) : (
        <ProUpgradePrompt
          title={title ?? t('admin.upgrade.title')}
          description={description ?? t('admin.upgrade.memberDescription', { feature: featureLabel })}
          note={t('admin.upgrade.askAdmin')}
        />
      )}
    </div>
  )
}
