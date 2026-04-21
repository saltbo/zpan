import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Image } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { EnableFeatureEmpty } from '@/components/image-host/enable-feature-empty'
import { PageHeader } from '@/components/layout/page-header'
import { enableIhostFeature, getIhostConfig } from '@/lib/api'
import { useActiveOrganization, useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/image-host/')({
  component: ImageHostPage,
})

const IHOST_CONFIG_QUERY_KEY = (orgId: string | undefined) => ['ihost', 'config', orgId]

function ImageHostPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const { data: activeOrg } = useActiveOrganization()

  const orgId = activeOrg?.id
  const currentUserId = session?.user?.id
  const myMembership = activeOrg?.members?.find((m: { userId: string; role: string }) => m.userId === currentUserId)
  const canEnable = myMembership?.role === 'owner' || myMembership?.role === 'admin'

  const configQuery = useQuery({
    queryKey: IHOST_CONFIG_QUERY_KEY(orgId),
    queryFn: getIhostConfig,
    enabled: !!session,
  })

  const enableMutation = useMutation({
    mutationFn: enableIhostFeature,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: IHOST_CONFIG_QUERY_KEY(orgId) })
    },
    onError: (err) => {
      toast.error(err.message)
    },
  })

  if (configQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  const config = configQuery.data

  if (!config?.enabled) {
    return (
      <EnableFeatureEmpty
        canEnable={canEnable}
        isEnabling={enableMutation.isPending}
        onEnable={() => enableMutation.mutate()}
      />
    )
  }

  // TODO T7: Replace this stub with the full Image Host gallery page
  return (
    <div className="space-y-4">
      <PageHeader
        items={[
          {
            label: t('ihost.title'),
            icon: <Image className="size-4 text-muted-foreground" />,
          },
        ]}
      />
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground">
        <Image className="h-16 w-16" />
        <p className="text-sm">{t('ihost.empty.description')}</p>
      </div>
    </div>
  )
}
