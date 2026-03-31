import type { StorageObject } from '@zpan/shared'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Eye, Download, Pencil, FolderInput, Copy, Trash2, Info } from 'lucide-react'
import { isFolder } from '../utils'

interface FileContextMenuProps {
  item: StorageObject
  children: React.ReactNode
  onPreview: () => void
  onDownload: () => void
  onRename: () => void
  onMove: () => void
  onCopy: () => void
  onTrash: () => void
  onProperties: () => void
}

export function FileContextMenu({
  item,
  children,
  onPreview,
  onDownload,
  onRename,
  onMove,
  onCopy,
  onTrash,
  onProperties,
}: FileContextMenuProps) {
  const folder = isFolder(item)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {!folder && (
          <ContextMenuItem onClick={onPreview}>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </ContextMenuItem>
        )}
        {!folder && (
          <ContextMenuItem onClick={onDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </ContextMenuItem>
        )}
        {!folder && <ContextMenuSeparator />}
        <ContextMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={onMove}>
          <FolderInput className="mr-2 h-4 w-4" />
          Move to...
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopy}>
          <Copy className="mr-2 h-4 w-4" />
          Copy to...
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onTrash} className="text-destructive focus:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Move to Trash
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
