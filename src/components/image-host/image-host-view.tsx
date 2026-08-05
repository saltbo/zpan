import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileManager } from '@/components/files/file-manager'
import { useClipboard } from '@/hooks/use-clipboard'
import { deleteIhostImage } from '@/lib/api'
import { deleteImageHostItems, imageHostCopyText } from './image-host-actions'
import { imageHostDataSource } from './image-host-data-source'

const IHOST_VIEW_MODE_KEY = 'zpan-ihost-view-mode'

export function ImageHostView() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { copy } = useClipboard()
  // Store pending delete timeouts: id → timeoutId
  const pendingDeletes = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  function handleDeleteItems(ids: string[]) {
    deleteImageHostItems(ids, {
      queryClient,
      pendingDeletes: pendingDeletes.current,
      t,
      toast,
      deleteImage: deleteIhostImage,
    })
  }

  function handleCopyUrl(
    item: Parameters<typeof imageHostCopyText>[0],
    format?: Parameters<typeof imageHostCopyText>[1],
  ) {
    copy(imageHostCopyText(item, format, window.location.origin), 'ihost.copy.copied')
  }

  return (
    <FileManager
      rootName={t('ihost.title')}
      dataSource={imageHostDataSource}
      capabilities={{
        upload: true,
        delete: true,
        copyUrl: true,
        selection: true,
        dragAndDrop: false,
        rename: false,
        copy: false,
        move: false,
        share: false,
        trash: false,
        createFolder: false,
      }}
      emptyStateLabel={t('ihost.empty.description')}
      getThumbnailUrl={imageHostDataSource.getThumbnailUrl}
      onDeleteItems={handleDeleteItems}
      onCopyUrl={handleCopyUrl}
      viewModeStorageKey={IHOST_VIEW_MODE_KEY}
    />
  )
}
