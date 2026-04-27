import { createFileRoute } from '@tanstack/react-router'
import { OAuthProvidersSection } from '@/components/admin/oauth-providers-section'

export const Route = createFileRoute('/_authenticated/admin/settings/oauth')({
  component: AuthSettingsPage,
})

function AuthSettingsPage() {
  return <OAuthProvidersSection />
}
