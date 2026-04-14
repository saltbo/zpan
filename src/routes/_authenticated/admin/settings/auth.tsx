import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { EmailConfigSection } from '@/components/admin/email-config-section'
import { InviteCodesSection } from '@/components/admin/invite-codes-section'
import { OAuthProvidersSection } from '@/components/admin/oauth-providers-section'
import { RegistrationModeSection } from '@/components/admin/registration-mode-section'

export const Route = createFileRoute('/_authenticated/admin/settings/auth')({
  component: AuthSettingsPage,
})

function AuthSettingsPage() {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">{t('admin.auth.title')}</h2>
      <div className="max-w-4xl space-y-6">
        <RegistrationModeSection />
        <InviteCodesSection />
        <OAuthProvidersSection />
        <EmailConfigSection />
      </div>
    </div>
  )
}
