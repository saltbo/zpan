import type { StorageObject } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileManager } from '@/components/files/file-manager'
import { useClipboard } from '@/hooks/use-clipboard'
import { deleteIhostImage } from '@/lib/api'
import { type IhostItem, imageHostDataSource } from './image-host-data-source'

const IHOST_VIEW_MODE_KEY = 'zpan-ihost-view-mode'

export function buildCopyText(url: string, format?: 'raw' | 'markdown' | 'html' | 'bbcode'): string {
  switch (format) {
    case 'markdown':
      return `![](${url})`
    case 'html':
      return `<img src="${url}" />`
    case 'bbcode':
      return `[img]${url}[/img]`
    default:
      return url
  }
}

export function ImageHostView() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { copy } = useClipboard()
  // Store pending delete timeouts: id → timeoutId
  const pendingDeletes = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  function handleDeleteItems(ids: string[]) {
    // Optimistically remove from cache, then schedule the real delete with undo
    queryClient.setQueryData(
      [...imageHostDataSource.queryKeyPrefix, '', undefined],
      (old: { items: StorageObject[] } | undefined) => {
        if (!old) return old
        return { ...old, items: old.items.filter((i) => !ids.includes(i.id)) }
      },
    )

    let cancelled = false

    const toastId = toast(t('ihost.delete.undoToast'), {
      action: {
        label: t('ihost.delete.undo'),
        onClick: () => {
          cancelled = true
          for (const id of ids) {
            const tid = pendingDeletes.current.get(id)
            if (tid != null) {
              clearTimeout(tid)
              pendingDeletes.current.delete(id)
            }
          }
          // Restore items by refetching
          queryClient.invalidateQueries({ queryKey: imageHostDataSource.queryKeyPrefix })
          toast.dismiss(toastId)
        },
      },
      duration: 5000,
    })

    for (const id of ids) {
      const tid = setTimeout(async () => {
        pendingDeletes.current.delete(id)
        if (cancelled) return
        try {
          await deleteIhostImage(id)
        } catch {
          // Re-fetch to restore state if delete failed
          queryClient.invalidateQueries({ queryKey: imageHostDataSource.queryKeyPrefix })
          toast.error(t('common.error'))
        }
      }, 5000)
      pendingDeletes.current.set(id, tid)
    }
  }

  function handleCopyUrl(item: StorageObject, format?: 'raw' | 'markdown' | 'html' | 'bbcode') {
    const ihostItem = item as IhostItem
    copy(buildCopyText(ihostItem.url ?? '', format), 'ihost.copy.copied')
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
