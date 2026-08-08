import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import {
  Archive,
  ArrowRightLeft,
  Copy,
  Download,
  Eye,
  FileArchive,
  FolderInput,
  FolderOpen,
  Info,
  Link,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import type { FileActionHandlers } from './types'

type MenuKind = 'context' | 'dropdown'

interface FileActionsMenuProps {
  item: StorageObject
  handlers: FileActionHandlers
}

interface MenuItemProps {
  kind: MenuKind
  children: ReactNode
  onClick: () => void
  destructive?: boolean
}

function MenuItem({ kind, children, onClick, destructive = false }: MenuItemProps) {
  const variant = destructive ? 'destructive' : 'default'
  return kind === 'dropdown' ? (
    <DropdownMenuItem variant={variant} onClick={onClick}>
      {children}
    </DropdownMenuItem>
  ) : (
    <ContextMenuItem variant={variant} onClick={onClick}>
      {children}
    </ContextMenuItem>
  )
}

function MenuSeparator({ kind }: { kind: MenuKind }) {
  return kind === 'dropdown' ? <DropdownMenuSeparator /> : <ContextMenuSeparator />
}

function CopyUrlSubmenu({
  kind,
  item,
  onCopyUrl,
}: {
  kind: MenuKind
  item: StorageObject
  onCopyUrl: NonNullable<FileActionHandlers['onCopyUrl']>
}) {
  const { t } = useTranslation()
  const items = (
    <>
      <MenuItem kind={kind} onClick={() => onCopyUrl(item, 'raw')}>
        {t('ihost.copy.raw')}
      </MenuItem>
      <MenuItem kind={kind} onClick={() => onCopyUrl(item, 'markdown')}>
        {t('ihost.copy.markdown')}
      </MenuItem>
      <MenuItem kind={kind} onClick={() => onCopyUrl(item, 'html')}>
        {t('ihost.copy.html')}
      </MenuItem>
      <MenuItem kind={kind} onClick={() => onCopyUrl(item, 'bbcode')}>
        {t('ihost.copy.bbcode')}
      </MenuItem>
    </>
  )

  return kind === 'dropdown' ? (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Link />
        {t('ihost.copy.url')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>{items}</DropdownMenuSubContent>
    </DropdownMenuSub>
  ) : (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="gap-2">
        <Link />
        {t('ihost.copy.url')}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>{items}</ContextMenuSubContent>
    </ContextMenuSub>
  )
}

function FileActionsMenuItems({ kind, item, handlers }: FileActionsMenuProps & { kind: MenuKind }) {
  const { t } = useTranslation()
  const isFile = item.dirtype === DirType.FILE
  const isZipFile = isFile && item.name.toLowerCase().endsWith('.zip')
  const hasManagementActions = !!(
    handlers.onRename ||
    handlers.onCopy ||
    handlers.onMove ||
    handlers.onTransfer ||
    handlers.onShare ||
    handlers.onCompress ||
    (isZipFile && handlers.onExtract)
  )
  const hasDestructiveActions = !!(handlers.onTrash || handlers.onDelete)

  return (
    <>
      {handlers.onDetails && (
        <MenuItem kind={kind} onClick={() => handlers.onDetails?.(item)}>
          <Info />
          {t('files.details')}
        </MenuItem>
      )}
      <MenuItem kind={kind} onClick={() => handlers.onOpen(item)}>
        {isFile ? <Eye /> : <FolderOpen />}
        {isFile ? t('files.preview') : t('files.open')}
      </MenuItem>
      {isFile && handlers.onDownload && (
        <MenuItem kind={kind} onClick={() => handlers.onDownload?.(item)}>
          <Download />
          {t('files.download')}
        </MenuItem>
      )}
      {handlers.onCopyUrl && <CopyUrlSubmenu kind={kind} item={item} onCopyUrl={handlers.onCopyUrl} />}

      {hasManagementActions && <MenuSeparator kind={kind} />}
      {handlers.onRename && (
        <MenuItem kind={kind} onClick={() => handlers.onRename?.(item)}>
          <Pencil />
          {t('files.rename')}
        </MenuItem>
      )}
      {handlers.onCopy && (
        <MenuItem kind={kind} onClick={() => handlers.onCopy?.(item)}>
          <Copy />
          {t('files.copy')}
        </MenuItem>
      )}
      {handlers.onMove && (
        <MenuItem kind={kind} onClick={() => handlers.onMove?.(item)}>
          <FolderInput />
          {t('files.moveTo')}
        </MenuItem>
      )}
      {handlers.onTransfer && (
        <MenuItem kind={kind} onClick={() => handlers.onTransfer?.(item)}>
          <ArrowRightLeft />
          {t('files.transferToSpace')}
        </MenuItem>
      )}
      {handlers.onShare && (
        <MenuItem kind={kind} onClick={() => handlers.onShare?.(item)}>
          <Share2 />
          {t('share.menuItem')}
        </MenuItem>
      )}
      {handlers.onCompress && (
        <MenuItem kind={kind} onClick={() => handlers.onCompress?.(item)}>
          <Archive />
          {t('files.compress')}
        </MenuItem>
      )}
      {isZipFile && handlers.onExtract && (
        <MenuItem kind={kind} onClick={() => handlers.onExtract?.(item)}>
          <FileArchive />
          {t('files.extract')}
        </MenuItem>
      )}

      {hasDestructiveActions && <MenuSeparator kind={kind} />}
      {handlers.onTrash && (
        <MenuItem kind={kind} destructive onClick={() => handlers.onTrash?.(item)}>
          <Trash2 />
          {t('files.moveToTrash')}
        </MenuItem>
      )}
      {handlers.onDelete && (
        <MenuItem kind={kind} destructive onClick={() => handlers.onDelete?.(item)}>
          <Trash2 />
          {t('common.delete')}
        </MenuItem>
      )}
    </>
  )
}

export function FileActionsDropdownContent({ item, handlers }: FileActionsMenuProps) {
  return (
    <DropdownMenuContent align="end" className="w-48">
      <FileActionsMenuItems kind="dropdown" item={item} handlers={handlers} />
    </DropdownMenuContent>
  )
}

export function FileActionsContextContent({ item, handlers }: FileActionsMenuProps) {
  return (
    <ContextMenuContent className="w-48">
      <FileActionsMenuItems kind="context" item={item} handlers={handlers} />
    </ContextMenuContent>
  )
}
