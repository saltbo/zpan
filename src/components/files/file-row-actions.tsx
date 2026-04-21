import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { Copy, Download, EllipsisVertical, FolderInput, Link, Pencil, Share2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FileActionHandlers } from './types'

interface FileRowActionsProps {
  item: StorageObject
  handlers: FileActionHandlers
}

export function FileRowActions({ item, handlers }: FileRowActionsProps) {
  const { t } = useTranslation()
  const isFile = item.dirtype === DirType.FILE
  const hasActions = !!(
    (isFile && handlers.onDownload) ||
    handlers.onRename ||
    handlers.onCopy ||
    handlers.onMove ||
    handlers.onShare ||
    handlers.onCopyUrl ||
    handlers.onTrash ||
    handlers.onDelete
  )

  if (!hasActions) return null

  const hasWriteActions = !!(
    handlers.onRename ||
    handlers.onCopy ||
    handlers.onMove ||
    handlers.onShare ||
    (isFile && handlers.onDownload)
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {isFile && handlers.onDownload && (
          <DropdownMenuItem onClick={() => handlers.onDownload?.(item)}>
            <Download className="mr-2 h-4 w-4" />
            {t('files.download')}
          </DropdownMenuItem>
        )}
        {handlers.onCopyUrl && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Link className="mr-2 h-4 w-4" />
              {t('ihost.copy.url')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => handlers.onCopyUrl?.(item, 'raw')}>
                {t('ihost.copy.raw')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlers.onCopyUrl?.(item, 'markdown')}>
                {t('ihost.copy.markdown')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlers.onCopyUrl?.(item, 'html')}>
                {t('ihost.copy.html')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlers.onCopyUrl?.(item, 'bbcode')}>
                {t('ihost.copy.bbcode')}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {handlers.onRename && (
          <DropdownMenuItem onClick={() => handlers.onRename?.(item)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t('files.rename')}
          </DropdownMenuItem>
        )}
        {handlers.onCopy && (
          <DropdownMenuItem onClick={() => handlers.onCopy?.(item)}>
            <Copy className="mr-2 h-4 w-4" />
            {t('files.copy')}
          </DropdownMenuItem>
        )}
        {handlers.onMove && (
          <DropdownMenuItem onClick={() => handlers.onMove?.(item)}>
            <FolderInput className="mr-2 h-4 w-4" />
            {t('files.moveTo')}
          </DropdownMenuItem>
        )}
        {handlers.onShare && (
          <DropdownMenuItem onClick={() => handlers.onShare?.(item)}>
            <Share2 className="mr-2 h-4 w-4" />
            {t('share.menuItem')}
          </DropdownMenuItem>
        )}
        {handlers.onTrash && (
          <>
            {hasWriteActions && <DropdownMenuSeparator />}
            <DropdownMenuItem className="text-destructive" onClick={() => handlers.onTrash?.(item)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('files.moveToTrash')}
            </DropdownMenuItem>
          </>
        )}
        {handlers.onDelete && (
          <>
            {hasWriteActions && <DropdownMenuSeparator />}
            <DropdownMenuItem className="text-destructive" onClick={() => handlers.onDelete?.(item)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t('common.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
