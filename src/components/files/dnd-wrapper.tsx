import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { DirType } from '@shared/constants'
import type { StorageObject } from '@shared/types'
import { useState } from 'react'
import { FileIcon } from './file-icon'

interface DndWrapperProps {
  children: React.ReactNode
  onDrop: (draggedIds: string[], targetPath: string) => void
}

function itemPath(item: StorageObject): string {
  return item.parent ? `${item.parent}/${item.name}` : item.name
}

export function DndWrapper({ children, onDrop }: DndWrapperProps) {
  const [activeItem, setActiveItem] = useState<StorageObject | null>(null)
  const [draggedItems, setDraggedItems] = useState<StorageObject[]>([])
  const [draggedIds, setDraggedIds] = useState<string[]>([])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function handleDragStart(event: DragStartEvent) {
    const item = event.active.data.current?.item as StorageObject | undefined
    const allItems = event.active.data.current?.allItems as StorageObject[] | undefined
    const selectedIds = event.active.data.current?.selectedIds as string[] | undefined
    if (!item) return

    setActiveItem(item)
    const ids = selectedIds?.includes(item.id) ? selectedIds : [item.id]
    setDraggedIds(ids)
    setDraggedItems(allItems?.filter((i) => ids.includes(i.id)) ?? [item])
  }

  function handleDragEnd(event: DragEndEvent) {
    const folderPath = event.over?.data.current?.folderPath as string | undefined
    if (folderPath !== undefined && draggedIds.length > 0 && isDropAllowed(folderPath)) {
      onDrop(draggedIds, folderPath)
    }
    setActiveItem(null)
    setDraggedIds([])
    setDraggedItems([])
  }

  function isDropAllowed(targetPath: string): boolean {
    for (const item of draggedItems) {
      if (item.dirtype === DirType.FILE) continue
      const path = itemPath(item)
      // Can't drop a folder into itself or its descendants
      if (targetPath === path || targetPath.startsWith(`${path}/`)) return false
    }
    return true
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {children}
      <DragOverlay>
        {activeItem && (
          <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 shadow-lg">
            <FileIcon item={activeItem} />
            <span className="text-sm">{activeItem.name}</span>
            {draggedIds.length > 1 && (
              <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
                +{draggedIds.length - 1}
              </span>
            )}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
