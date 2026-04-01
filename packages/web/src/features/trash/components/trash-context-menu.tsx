import type { StorageObject } from '@zpan/shared'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { RotateCcw, Trash2, Info } from 'lucide-react'

interface TrashContextMenuProps {
  item: StorageObject
  children: React.ReactNode
  onRestore: () => void
  onDeleteForever: () => void
  onProperties: () => void
}

export function TrashContextMenu({
  children,
  onRestore,
  onDeleteForever,
  onProperties,
}: TrashContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRestore}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Restore
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onDeleteForever}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Forever
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onProperties}>
          <Info className="mr-2 h-4 w-4" />
          Properties
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
