import { createFileRoute } from '@tanstack/react-router'
import { OAuthProvidersSection } from '@/components/admin/oauth-providers-section'
import { RegisteredOAuthApplicationsSection } from '@/components/admin/registered-oauth-applications-section'

export const Route = createFileRoute('/_authenticated/admin/settings/oauth')({
  component: AuthSettingsPage,
})

function AuthSettingsPage() {
  return (
    <div className="space-y-8">
      <OAuthProvidersSection />
      <RegisteredOAuthApplicationsSection />
    </div>
  )
}
