import type { StorageObject } from '@shared/types'
import { EllipsisVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FileActionsDropdownContent } from './file-actions-menu'
import type { FileActionHandlers } from './types'

interface FileRowActionsProps {
  item: StorageObject
  handlers: FileActionHandlers
}

export function FileRowActions({ item, handlers }: FileRowActionsProps) {
  const { t } = useTranslation()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={t('common.actions')} onClick={(e) => e.stopPropagation()}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <FileActionsDropdownContent item={item} handlers={handlers} />
    </DropdownMenu>
  )
}
