import { useDraggable, useDroppable } from '@dnd-kit/core'
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import type { Row, Table as TanstackTable } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { FileIcon } from './file-icon'
import type { FileActionHandlers } from './types'

interface FilesGridProps {
  table: TanstackTable<StorageObject>
  handlers: FileActionHandlers
  selectedIds: string[]
  currentPath: string
  dragAndDropEnabled?: boolean
  selectionEnabled?: boolean
  getThumbnailUrl?: (item: StorageObject) => string | null
}

function buildPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function ThumbnailImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full rounded-md object-cover"
    />
  )
}

function DraggableGridCard({
  row,
  handlers,
  selectedIds,
  currentPath,
  allItems,
  getThumbnailUrl,
}: {
  row: Row<StorageObject>
  handlers: FileActionHandlers
  selectedIds: string[]
  currentPath: string
  allItems: StorageObject[]
  getThumbnailUrl?: (item: StorageObject) => string | null
}) {
  const { t } = useTranslation()
  const item = row.original
  const selected = row.getIsSelected()
  const isFolder = item.dirtype !== DirType.FILE
  const isFile = item.dirtype === DirType.FILE
  const folderPath = isFolder ? buildPath(currentPath, item.name) : ''

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `folder-${item.id}`,
    data: { folderPath },
    disabled: !isFolder,
  })

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `drag-${item.id}`,
    data: { item, selectedIds, allItems },
  })

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit requires pointer listeners on the element */}
        <div
          ref={(node) => {
            setDragRef(node)
            if (isFolder) setDropRef(node)
          }}
          className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/50 ${selected ? 'border-primary bg-muted' : ''} ${isOver ? 'ring-2 ring-primary bg-primary/5' : ''} ${isDragging ? 'opacity-40' : ''}`}
          onDoubleClick={() => handlers.onOpen(item)}
          {...attributes}
          {...listeners}
        >
          <div
            className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 data-[visible=true]:opacity-100"
            data-visible={selected ? true : undefined}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => row.toggleSelected(!!v)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>
          {getThumbnailUrl && item.type?.startsWith('image/') ? (
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-muted">
              <ThumbnailImage src={getThumbnailUrl(item) ?? ''} alt={item.name} />
              {!getThumbnailUrl(item) && <FileIcon item={item} size="lg" />}
            </div>
          ) : (
            <FileIcon item={item} size="lg" />
          )}
          <span className="w-full truncate text-center text-sm font-medium">{item.name}</span>
          {isFile && <span className="text-xs text-muted-foreground">{item.type}</span>}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => handlers.onOpen(item)}>
          {isFile ? t('files.preview') : t('files.open')}
        </ContextMenuItem>
        {isFile && handlers.onDownload && (
          <ContextMenuItem onClick={() => handlers.onDownload?.(item)}>{t('files.download')}</ContextMenuItem>
        )}
        {handlers.onCopyUrl && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('ihost.copy.url')}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'raw')}>{t('ihost.copy.raw')}</ContextMenuItem>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'markdown')}>
                {t('ihost.copy.markdown')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'html')}>
                {t('ihost.copy.html')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'bbcode')}>
                {t('ihost.copy.bbcode')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        {handlers.onRename && (
          <ContextMenuItem onClick={() => handlers.onRename?.(item)}>{t('files.rename')}</ContextMenuItem>
        )}
        {handlers.onCopy && (
          <ContextMenuItem onClick={() => handlers.onCopy?.(item)}>{t('files.copy')}</ContextMenuItem>
        )}
        {handlers.onMove && (
          <ContextMenuItem onClick={() => handlers.onMove?.(item)}>{t('files.moveTo')}</ContextMenuItem>
        )}
        {handlers.onTrash && (
          <ContextMenuItem className="text-destructive" onClick={() => handlers.onTrash?.(item)}>
            {t('files.moveToTrash')}
          </ContextMenuItem>
        )}
        {handlers.onDelete && (
          <ContextMenuItem className="text-destructive" onClick={() => handlers.onDelete?.(item)}>
            {t('common.delete')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function PlainGridCard({
  row,
  handlers,
  getThumbnailUrl,
}: {
  row: Row<StorageObject>
  handlers: FileActionHandlers
  getThumbnailUrl?: (item: StorageObject) => string | null
}) {
  const { t } = useTranslation()
  const item = row.original
  const isFile = item.dirtype === DirType.FILE
  const showWriteActions = !!(
    handlers.onRename ||
    handlers.onCopy ||
    handlers.onMove ||
    handlers.onTrash ||
    handlers.onDelete
  )
  const thumbnailUrl = getThumbnailUrl && item.type?.startsWith('image/') ? getThumbnailUrl(item) : null

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className="group relative flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border p-4 transition-colors hover:bg-muted/50"
          onDoubleClick={() => handlers.onOpen(item)}
        >
          {thumbnailUrl ? (
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md bg-muted">
              <ThumbnailImage src={thumbnailUrl} alt={item.name} />
            </div>
          ) : (
            <FileIcon item={item} size="lg" />
          )}
          <span className="w-full truncate text-center text-sm font-medium">{item.name}</span>
          {isFile && <span className="text-xs text-muted-foreground">{item.type}</span>}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => handlers.onOpen(item)}>
          {isFile ? t('files.preview') : t('files.open')}
        </ContextMenuItem>
        {isFile && handlers.onDownload && (
          <ContextMenuItem onClick={() => handlers.onDownload?.(item)}>{t('files.download')}</ContextMenuItem>
        )}
        {handlers.onCopyUrl && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('ihost.copy.url')}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'raw')}>{t('ihost.copy.raw')}</ContextMenuItem>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'markdown')}>
                {t('ihost.copy.markdown')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'html')}>
                {t('ihost.copy.html')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handlers.onCopyUrl?.(item, 'bbcode')}>
                {t('ihost.copy.bbcode')}
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        {showWriteActions && <ContextMenuSeparator />}
        {handlers.onRename && (
          <ContextMenuItem onClick={() => handlers.onRename?.(item)}>{t('files.rename')}</ContextMenuItem>
        )}
        {handlers.onCopy && (
          <ContextMenuItem onClick={() => handlers.onCopy?.(item)}>{t('files.copy')}</ContextMenuItem>
        )}
        {handlers.onMove && (
          <ContextMenuItem onClick={() => handlers.onMove?.(item)}>{t('files.moveTo')}</ContextMenuItem>
        )}
        {handlers.onTrash && (
          <>
            {(handlers.onRename || handlers.onCopy || handlers.onMove) && <ContextMenuSeparator />}
            <ContextMenuItem className="text-destructive" onClick={() => handlers.onTrash?.(item)}>
              {t('files.moveToTrash')}
            </ContextMenuItem>
          </>
        )}
        {handlers.onDelete && (
          <ContextMenuItem className="text-destructive" onClick={() => handlers.onDelete?.(item)}>
            {t('common.delete')}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function FilesGrid({
  table,
  handlers,
  selectedIds,
  currentPath,
  dragAndDropEnabled = true,
  getThumbnailUrl,
}: FilesGridProps) {
  const { t } = useTranslation()
  const rows = table.getRowModel().rows

  if (rows.length === 0) {
    return <div className="flex h-24 items-center justify-center text-muted-foreground">{t('files.emptyState')}</div>
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 p-2">
      {rows.map((row) =>
        dragAndDropEnabled ? (
          <DraggableGridCard
            key={row.id}
            row={row}
            handlers={handlers}
            selectedIds={selectedIds}
            currentPath={currentPath}
            allItems={table.getRowModel().rows.map((r) => r.original)}
            getThumbnailUrl={getThumbnailUrl}
          />
        ) : (
          <PlainGridCard key={row.id} row={row} handlers={handlers} getThumbnailUrl={getThumbnailUrl} />
        ),
      )}
    </div>
  )
}
