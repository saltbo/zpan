import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ImageHostView } from '@/components/image-host/image-host-view'
import { getIhostConfig } from '@/lib/api'
import { useSession } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated/image-host/')({
  component: ImageHostPage,
})

const IHOST_CONFIG_QUERY_KEY = (orgId: string | undefined) => ['ihost', 'config', orgId]

function ImageHostPage() {
  const { t } = useTranslation()
  const { data: session } = useSession()

  const configQuery = useQuery({
    queryKey: IHOST_CONFIG_QUERY_KEY(undefined),
    queryFn: getIhostConfig,
    enabled: !!session,
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
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <p>{t('common.loading')}</p>
      </div>
    )
  }

  return <ImageHostView />
}
