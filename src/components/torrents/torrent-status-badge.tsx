import type { WorkspaceTorrentStatus } from '@shared/schemas'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

function variant(status: WorkspaceTorrentStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ready') return 'default'
  if (status === 'failed') return 'destructive'
  if (status === 'resolving') return 'outline'
  return 'secondary'
}

export function TorrentStatusBadge({ status }: { status: WorkspaceTorrentStatus }) {
  const { t } = useTranslation()
  return <Badge variant={variant(status)}>{t(`torrents.status.${status}`)}</Badge>
}
