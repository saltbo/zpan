import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { Copy, Download, EllipsisVertical, FolderInput, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {isFile && (
          <DropdownMenuItem onClick={() => handlers.onDownload(item)}>
            <Download className="mr-2 h-4 w-4" />
            {t('files.download')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => handlers.onRename(item)}>
          <Pencil className="mr-2 h-4 w-4" />
          {t('files.rename')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlers.onCopy(item)}>
          <Copy className="mr-2 h-4 w-4" />
          {t('files.copy')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handlers.onMove(item)}>
          <FolderInput className="mr-2 h-4 w-4" />
          {t('files.moveTo')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onClick={() => handlers.onTrash(item)}>
          <Trash2 className="mr-2 h-4 w-4" />
          {t('files.moveToTrash')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
