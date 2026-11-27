import type { WorkspaceTorrent, WorkspaceTorrentFile } from '@shared/schemas'
import { useQuery } from '@tanstack/react-query'
import { Download, FolderInput, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { LoadErrorAlert } from '@/components/errors/load-error-alert'
import type { PreviewFile } from '@/components/preview/file-preview-content'
import { FilePreviewDialog } from '@/components/preview/file-preview-dialog'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createWorkspaceTorrentFileLink, getWorkspaceTorrent } from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'
import { TorrentStatusBadge } from './torrent-status-badge'

export const workspaceTorrentQueryKey = (id: string) => ['workspace-torrents', 'detail', id]

const PLAYABLE_TYPES = /^(video|audio)\//

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

interface TorrentSheetProps {
  id: string | null
  onOpenChange: (open: boolean) => void
  onSave: (entry: WorkspaceTorrent) => void
  onRemove: (entry: WorkspaceTorrent) => void
}

// A torrent of the workspace's list with its own file tree; each file plays or
// downloads through a presigned link (docs/design/torrents.md §9).
export function TorrentSheet({ id, onOpenChange, onSave, onRemove }: TorrentSheetProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<PreviewFile | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const query = useQuery({
    queryKey: workspaceTorrentQueryKey(id ?? ''),
    queryFn: () => getWorkspaceTorrent(id as string),
    enabled: !!id,
  })
  const entry = query.data

  async function open(file: WorkspaceTorrentFile, mode: 'play' | 'download') {
    if (!entry) return
    setOpening(file.id)
    try {
      const link = await createWorkspaceTorrentFileLink(entry.id, file.id)
      if (mode === 'download') {
        window.open(link.url, '_blank', 'noopener')
        return
      }
      setPreview({ id: file.id, name: fileName(file.path), type: file.mime, size: file.size, downloadUrl: link.url })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'))
    } finally {
      setOpening(null)
    }
  }

  return (
    <>
      <Sheet open={!!id} onOpenChange={onOpenChange}>
        <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="break-all pr-6">{entry?.name ?? t('torrents.title')}</SheetTitle>
            <SheetDescription>{t('torrents.sheet.description')}</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 px-4 pb-6">
            {query.isPending ? (
              <p className="py-6 text-center text-sm text-muted-foreground" role="status">
                {t('common.loading')}
              </p>
            ) : query.isError || !entry ? (
              <LoadErrorAlert error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
            ) : (
              <>
                <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t('torrents.col.status')}</dt>
                  <dd>
                    <TorrentStatusBadge status={entry.status} />
                    {entry.error && <p className="mt-1 text-xs text-destructive">{entry.error}</p>}
                  </dd>
                  <dt className="text-muted-foreground">{t('torrents.col.size')}</dt>
                  <dd className="tabular-nums">{entry.size === null ? '—' : formatSize(entry.size)}</dd>
                  <dt className="text-muted-foreground">{t('torrents.col.source')}</dt>
                  <dd>{t(`torrents.source.${entry.source}`)}</dd>
                  <dt className="text-muted-foreground">{t('torrents.col.added')}</dt>
                  <dd>{formatDate(entry.createdAt)}</dd>
                  {entry.infoHash && (
                    <>
                      <dt className="text-muted-foreground">{t('torrents.infoHash')}</dt>
                      <dd className="break-all font-mono text-xs">{entry.infoHash}</dd>
                    </>
                  )}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => onSave(entry)} disabled={entry.status !== 'ready'}>
                    <FolderInput />
                    {t('torrents.save.action')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onRemove(entry)}>
                    <Trash2 />
                    {t('torrents.remove.action')}
                  </Button>
                </div>
                <Separator />
                <section aria-label={t('torrents.sheet.files')} className="space-y-2">
                  <h3 className="text-sm font-medium">{t('torrents.sheet.files')}</h3>
                  {entry.files.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('torrents.sheet.noFiles')}</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {entry.files.map((file) => (
                        <li key={file.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="truncate" title={file.path}>
                              {file.path}
                            </div>
                            <div className="text-xs text-muted-foreground tabular-nums">{formatSize(file.size)}</div>
                          </div>
                          {PLAYABLE_TYPES.test(file.mime) && (
                            <FileAction
                              label={t('torrents.sheet.play', { name: fileName(file.path) })}
                              tooltip={t('torrents.sheet.playTooltip')}
                              disabled={!entry.playable || opening === file.id}
                              onClick={() => open(file, 'play')}
                            >
                              <Play className="size-4" />
                            </FileAction>
                          )}
                          <FileAction
                            label={t('torrents.sheet.download', { name: fileName(file.path) })}
                            tooltip={t('torrents.sheet.downloadTooltip')}
                            disabled={!entry.playable || opening === file.id}
                            onClick={() => open(file, 'download')}
                          >
                            <Download className="size-4" />
                          </FileAction>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <FilePreviewDialog
        file={preview}
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null)
        }}
      />
    </>
  )
}

function FileAction({
  label,
  tooltip,
  disabled,
  onClick,
  children,
}: {
  label: string
  tooltip: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
