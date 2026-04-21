import type { ShareListItem } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getShare } from '@/lib/api'

interface ShareDetailPanelProps {
  share: ShareListItem | null
  onClose: () => void
}

function shareUrl(share: ShareListItem): string {
  const base = window.location.origin
  return share.kind === 'landing' ? `${base}/s/${share.token}` : `${base}/r/${share.token}`
}

export function ShareDetailPanel({ share, onClose }: ShareDetailPanelProps) {
  const { t } = useTranslation()

  const detailQuery = useQuery({
    queryKey: ['shares', share?.token, 'detail'],
    queryFn: () => getShare(share!.token),
    enabled: !!share,
  })

  const detail = detailQuery.data
  const views = detail?.views ?? share?.views ?? 0
  const downloads = detail?.downloads ?? share?.downloads ?? 0
  const downloadLimit = detail?.downloadLimit ?? share?.downloadLimit ?? null

  return (
    <Sheet open={!!share} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t('shares.detailTitle')}</SheetTitle>
        </SheetHeader>

        {share && (
          <div className="px-4 pb-4 space-y-5">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                {share.kind === 'landing' ? t('shares.detailLandingUrl') : t('shares.detailDirectUrl')}
              </p>
              <p className="text-sm break-all font-mono bg-muted rounded px-2 py-1.5 select-all">{shareUrl(share)}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">{t('shares.detailCreatedAt')}</p>
              <p className="text-sm">{new Date(share.createdAt).toLocaleString()}</p>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">{t('shares.detailRecipients')}</p>
              {detail?.recipients && detail.recipients.length > 0 ? (
                <ul className="space-y-1">
                  {detail.recipients.map((r) => (
                    <li key={r.id} className="text-sm">
                      {r.recipientEmail ?? r.recipientUserId ?? '—'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {detailQuery.isLoading ? t('common.loading') : t('shares.detailNoRecipients')}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{t('shares.colViews')}</p>
                <p className="text-sm tabular-nums">{views}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">{t('shares.colDownloads')}</p>
                <p className="text-sm tabular-nums">
                  {downloadLimit != null ? `${downloads} / ${downloadLimit}` : downloads}
                </p>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
