import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ApiKeysPanel } from '@/components/image-host-settings/api-keys-panel'
import { CustomDomainPanel } from '@/components/image-host-settings/custom-domain-panel'
import { DisableFeaturePanel } from '@/components/image-host-settings/disable-feature-panel'
import { RefererAllowlistPanel } from '@/components/image-host-settings/referer-allowlist-panel'
import { Card } from '@/components/ui/card'
import { getIhostConfig } from '@/lib/api'
import { useActiveOrganization, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/ihost')({
  component: ImageHostSettingsPage,
})

function LockedState() {
  const { t } = useTranslation()
  return (
    <Card className="flex flex-col items-center gap-3 p-8 shadow-none">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{t('settings.ihost.lockedTitle')}</p>
      <p className="text-xs text-muted-foreground text-center">{t('settings.ihost.lockedDescription')}</p>
    </Card>
  )
}

function ImageHostSettingsPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()

  const orgId = activeOrg?.id
  const currentUserId = session?.user?.id
  const myMembership = activeOrg?.members?.find((m: { userId: string; role: string }) => m.userId === currentUserId)
  const isOwnerOrAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin'

  const configQuery = useQuery({
    queryKey: ['ihost', 'config', orgId],
    queryFn: getIhostConfig,
    enabled: !!session && !!orgId,
  })

  if (!isOwnerOrAdmin) {
    return (
      <div className="max-w-2xl space-y-4">
        <h2 className="text-sm font-semibold">{t('settings.ihost.title')}</h2>
        <LockedState />
      </div>
    )
  }

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    )
  }

  const config = configQuery.data

  if (!config?.enabled || !orgId) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-sm font-semibold">{t('settings.ihost.title')}</h2>
      <ApiKeysPanel orgId={orgId} />
      <CustomDomainPanel orgId={orgId} config={config} />
      <RefererAllowlistPanel orgId={orgId} config={config} />
      <DisableFeaturePanel orgId={orgId} />
    </div>
  )
}
