import type { MediaLibrary } from '@shared/schemas'
import type { StorageObject } from '@shared/types'

export interface FileActionHandlers {
  onOpen: (item: StorageObject) => void
  onDetails?: (item: StorageObject) => void
  onRename?: (item: StorageObject) => void
  onTrash?: (item: StorageObject) => void
  onDelete?: (item: StorageObject) => void
  onCopy?: (item: StorageObject) => void
  onMove?: (item: StorageObject) => void
  onTransfer?: (item: StorageObject) => void
  onDownload?: (item: StorageObject) => void
  onShare?: (item: StorageObject) => void
  onCopyUrl?: (item: StorageObject, format?: 'raw' | 'markdown' | 'html' | 'bbcode') => void
  onCompress?: (item: StorageObject) => void
  onExtract?: (item: StorageObject) => void
  mediaLibrary?: MediaLibraryActions
}

export interface MediaLibraryActions {
  // Without the media_library entitlement, only removing an existing library
  // is offered; nothing invites marking a new one.
  locked: boolean
  libraryFor: (folder: StorageObject) => MediaLibrary | undefined
  onSet: (folder: StorageObject) => void
  onRemove: (library: MediaLibrary) => void
  onRescan: (library: MediaLibrary) => void
  onScrape: (library: MediaLibrary) => void
}

export interface BreadcrumbItem {
  id: string
  name: string
}
