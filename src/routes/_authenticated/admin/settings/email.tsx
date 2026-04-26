import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { EmailConfigSection } from '@/components/admin/email-config-section'

export const Route = createFileRoute('/_authenticated/admin/settings/email')({
  component: EmailSettingsPage,
})

function EmailSettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('admin.nav.email')}</h2>
      <div className="max-w-4xl">
        <EmailConfigSection />
      </div>
    </div>
  )
}
