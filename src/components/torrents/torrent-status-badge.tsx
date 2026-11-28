import type { WorkspaceTorrent, WorkspaceTorrentStatus } from '@shared/schemas'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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

// The line under a failed or paused entry that says why.
export function TorrentStatusNote({
  entry,
  className,
}: {
  entry: Pick<WorkspaceTorrent, 'status' | 'error' | 'pauseReason'>
  className?: string
}) {
  const { t } = useTranslation()
  const text =
    entry.status === 'failed'
      ? entry.error
      : entry.status === 'paused' && entry.pauseReason
        ? t(`torrents.pauseReason.${entry.pauseReason}`)
        : null
  if (!text) return null
  return (
    <p
      className={cn('text-xs', entry.status === 'failed' ? 'text-destructive' : 'text-muted-foreground', className)}
      title={text}
    >
      {text}
    </p>
  )
}
