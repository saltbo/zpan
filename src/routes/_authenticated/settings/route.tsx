import { createFileRoute, Outlet } from '@tanstack/react-router'
import { Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/page-header'
import { PageTabs } from '@/components/layout/page-tabs'

export const Route = createFileRoute('/_authenticated/settings')({
  component: SettingsLayout,
})

function SettingsLayout() {
  const { t } = useTranslation()

  const tabs = [
    { to: '/settings/profile', label: t('settings.tabProfile') },
    { to: '/settings/password', label: t('settings.tabPassword') },
    { to: '/settings/appearance', label: t('settings.tabAppearance') },
    { to: '/settings/ihost', label: t('settings.tabImageHosting') },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        items={[
          {
            label: t('settings.title'),
            icon: <SettingsIcon className="size-4 text-muted-foreground" />,
          },
        ]}
      />
      <div className="border-b">
        <PageTabs items={tabs} />
      </div>
      <Outlet />
    </div>
  )
}
