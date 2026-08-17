import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatDate, formatSize } from '@/lib/format'
import { FileIcon } from './file-icon'
import { ObjectCreatorIdentity } from './object-creator'

interface FileDetailsSheetProps {
  item: StorageObject | null
  onOpenChange: (open: boolean) => void
}

export function FileDetailsSheet({ item, onOpenChange }: FileDetailsSheetProps) {
  const { t } = useTranslation()
  if (!item) return null
  const isFile = item.dirtype === DirType.FILE

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
        </dl>
      </SheetContent>
    </Sheet>
  )
}
