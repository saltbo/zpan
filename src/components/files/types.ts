import type { StorageObject } from '@shared/types'

export interface FileActionHandlers {
  onOpen: (item: StorageObject) => void
  onRename: (item: StorageObject) => void
  onTrash: (item: StorageObject) => void
  onCopy: (item: StorageObject) => void
  onMove: (item: StorageObject) => void
  onDownload: (item: StorageObject) => void
}

export interface BreadcrumbItem {
  id: string
  name: string
}
