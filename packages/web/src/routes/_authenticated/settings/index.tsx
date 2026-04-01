import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/_authenticated/settings/')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
      <Settings className="h-16 w-16" />
      <h2 className="text-xl font-medium">{t('settings.title')}</h2>
      <p className="text-sm">{t('settings.placeholder')}</p>
    </div>
  )
}
