import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { EmailConfigSection } from '@/components/admin/email-config-section'

export const Route = createFileRoute('/_authenticated/admin/settings/email')({
  component: EmailSettingsPage,
})

function EmailSettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('admin.nav.email')} />
      <div className="max-w-4xl">
        <EmailConfigSection />
      </div>
    </div>
  )
}
