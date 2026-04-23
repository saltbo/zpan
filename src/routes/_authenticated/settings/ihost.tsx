import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnableFeatureEmpty } from '@/components/image-host/enable-feature-empty'
import { ApiKeysPanel } from '@/components/image-host-settings/api-keys-panel'
import { CustomDomainPanel } from '@/components/image-host-settings/custom-domain-panel'
import { DisableFeaturePanel } from '@/components/image-host-settings/disable-feature-panel'
import { RefererAllowlistPanel } from '@/components/image-host-settings/referer-allowlist-panel'
import { ToolIntegrationPanel } from '@/components/image-host-settings/tool-integration-panel'
import { Card, CardContent } from '@/components/ui/card'
import { enableIhostFeature, getIhostConfig } from '@/lib/api'
import { useActiveOrganization, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/settings/ihost')({
  component: ImageHostSettingsPage,
})

function LockedState() {
  const { t } = useTranslation()
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t('settings.ihost.lockedTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('settings.ihost.lockedDescription')}</p>
      </CardContent>
    </Card>
  )
}

function ImageHostSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
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

  const enableMutation = useMutation({
    mutationFn: enableIhostFeature,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ihost', 'config', orgId] })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (!isOwnerOrAdmin) {
    return (
      <div className="max-w-2xl">
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
      <EnableFeatureEmpty
        canEnable={isOwnerOrAdmin}
        isEnabling={enableMutation.isPending}
        onEnable={() => enableMutation.mutate()}
      />
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <ApiKeysPanel orgId={orgId} />
      <ToolIntegrationPanel orgId={orgId} />
      <CustomDomainPanel orgId={orgId} config={config} />
      <RefererAllowlistPanel orgId={orgId} config={config} />
      <DisableFeaturePanel orgId={orgId} />
    </div>
  )
}
