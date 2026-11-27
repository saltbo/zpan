import { DirType, isTorrentCacheKey } from '@shared/constants'
import type { ObjectTorrent } from '@shared/schemas'
import type { StorageObject } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { Magnet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getObjectTorrent } from '@/lib/api'
import { formatDate, formatSize } from '@/lib/format'
import { FileIcon } from './file-icon'
import { ObjectCreatorIdentity } from './object-creator'
import type { MediaLibraryActions } from './types'

interface FileDetailsSheetProps {
  item: StorageObject | null
  onOpenChange: (open: boolean) => void
  mediaLibrary?: MediaLibraryActions
}

export function FileDetailsSheet({ item, onOpenChange, mediaLibrary }: FileDetailsSheetProps) {
  const { t } = useTranslation()
  if (!item) return null
  const isFile = item.dirtype === DirType.FILE
  const isCached = isFile && isTorrentCacheKey(item.object)

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center gap-3 pr-8">
            <FileIcon item={item} size="lg" />
            <div className="min-w-0">
              <SheetTitle className="truncate">{item.name}</SheetTitle>
              <SheetDescription>{isFile ? item.type || t('files.unknownType') : t('files.folder')}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <Separator />
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-4 px-4 text-sm">
          <dt className="text-muted-foreground">{t('files.createdBy')}</dt>
          <dd className="min-w-0">
            <ObjectCreatorIdentity item={item} />
          </dd>
          <dt className="text-muted-foreground">{t('files.createdAt')}</dt>
          <dd>{formatDate(item.createdAt)}</dd>
          <dt className="text-muted-foreground">{t('files.modifiedAt')}</dt>
          <dd>{formatDate(item.updatedAt)}</dd>
          <dt className="text-muted-foreground">{t('files.size')}</dt>
          <dd>{isFile ? formatSize(item.size) : '—'}</dd>
          <dt className="text-muted-foreground">{t('files.location')}</dt>
          <dd className="min-w-0 break-words">/{item.parent}</dd>
          {!isFile && mediaLibrary && <MediaLibraryDetails folder={item} actions={mediaLibrary} />}
          {isCached && <CachedTorrentDetails file={item} />}
        </dl>
        {isCached && <p className="px-4 text-sm text-muted-foreground">{t('files.torrent.readOnly')}</p>}
      </SheetContent>
    </Sheet>
  )
}

function MediaLibraryDetails({ folder, actions }: { folder: StorageObject; actions: MediaLibraryActions }) {
  const { t } = useTranslation()
  const library = actions.libraryFor(folder)
  if (!library && actions.locked) return null
  const status = !library
    ? t('mediaLibrary.none')
    : library.scanning
      ? t('mediaLibrary.scanning')
      : library.lastScannedAt
        ? t('mediaLibrary.lastScanned', { date: formatDate(library.lastScannedAt) })
        : t('mediaLibrary.notScanned')

  return (
    <>
      <dt className="text-muted-foreground">{t('mediaLibrary.title')}</dt>
      <dd>{status}</dd>
      {library && (
        <>
          <dt className="text-muted-foreground">{t('mediaLibrary.indexFile')}</dt>
          <dd className="min-w-0 break-words font-mono text-xs">/{library.folderPath}/library.json</dd>
        </>
      )}
    </>
  )
}

function torrentStatusVariant(status: ObjectTorrent['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ready') return 'default'
  if (status === 'invalid') return 'destructive'
  if (status === 'evicting') return 'outline'
  return 'secondary'
}

// A file whose object is in the torrent cache references bytes the instance
// shares; its content is read-only (docs/design/torrent-cache.md §9).
function CachedTorrentDetails({ file }: { file: StorageObject }) {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['objects', file.id, 'torrent'],
    queryFn: () => getObjectTorrent(file.id),
    staleTime: 60 * 1000,
    retry: false,
  })
  const torrent = query.data

  return (
    <>
      <dt className="text-muted-foreground">{t('files.torrent.source')}</dt>
      <dd>
        <Badge variant="secondary">
          <Magnet />
          {t('files.torrent.mark')}
        </Badge>
      </dd>
      {torrent && (
        <>
          <dt className="text-muted-foreground">{t('files.torrent.name')}</dt>
          <dd className="min-w-0 break-words">{torrent.name}</dd>
          <dt className="text-muted-foreground">{t('files.torrent.infoHash')}</dt>
          <dd className="min-w-0 break-all font-mono text-xs">{torrent.infoHash}</dd>
          <dt className="text-muted-foreground">{t('files.torrent.verification')}</dt>
          <dd className="flex flex-wrap items-center gap-2">
            <Badge variant={torrentStatusVariant(torrent.status)}>{t(`files.torrent.status.${torrent.status}`)}</Badge>
            <span>{t(`files.torrent.verified.${torrent.verified ?? 'none'}`)}</span>
          </dd>
        </>
      )}
      {query.isError && (
        <>
          <dt className="text-muted-foreground">{t('files.torrent.name')}</dt>
          <dd className="text-muted-foreground">{t('files.torrent.loadFailed')}</dd>
        </>
      )}
    </>
  )
}
