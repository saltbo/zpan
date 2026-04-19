import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageTabs } from '@/components/layout/page-tabs'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const { t } = useTranslation()

  const tabs = [
    { to: '/settings/profile', label: t('settings.tabProfile') },
    { to: '/settings/appearance', label: t('settings.tabAppearance') },
    { to: '/settings/public', label: t('settings.tabPublic') },
  ]

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">{t('settings.title')}</h2>
      <div className="border-b">
        <PageTabs items={tabs} />
      </div>
      <Outlet />
    </div>
  )
}
