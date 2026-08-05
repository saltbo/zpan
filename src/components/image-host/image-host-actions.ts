import type { StorageObject } from '@shared/types'
import type { QueryClient } from '@tanstack/react-query'
import type { IhostItem } from './image-host-data-source'
import { imageHostDataSource } from './image-host-data-source'

type ToastController = {
  (message: string, options: { action: { label: string; onClick: () => void }; duration: number }): string | number
  dismiss(id: string | number): void
  error(message: string): void
}

export function deleteImageHostItems(
  ids: string[],
  deps: {
    queryClient: Pick<QueryClient, 'setQueryData' | 'invalidateQueries'>
    pendingDeletes: Map<string, ReturnType<typeof setTimeout>>
    t(key: string): string
    toast: ToastController
    deleteImage(id: string): Promise<unknown>
  },
) {
  deps.queryClient.setQueryData(
    [...imageHostDataSource.queryKeyPrefix, '', undefined],
    (old: { items: StorageObject[] } | undefined) => {
      if (!old) return old
      return { ...old, items: old.items.filter((item) => !ids.includes(item.id)) }
    },
  )

  let cancelled = false
  const toastId = deps.toast(deps.t('ihost.delete.undoToast'), {
    action: {
      label: deps.t('ihost.delete.undo'),
      onClick: () => {
        cancelled = true
        for (const id of ids) {
          const timeout = deps.pendingDeletes.get(id)
          if (timeout !== undefined) clearTimeout(timeout)
          deps.pendingDeletes.delete(id)
        }
        deps.queryClient.invalidateQueries({ queryKey: imageHostDataSource.queryKeyPrefix })
        deps.toast.dismiss(toastId)
      },
    },
    duration: 5000,
  })

  for (const id of ids) {
    const timeout = setTimeout(async () => {
      deps.pendingDeletes.delete(id)
      if (cancelled) return
      try {
        await deps.deleteImage(id)
      } catch {
        deps.queryClient.invalidateQueries({ queryKey: imageHostDataSource.queryKeyPrefix })
        deps.toast.error(deps.t('common.error'))
      }
    }, 5000)
    deps.pendingDeletes.set(id, timeout)
  }
}

export function imageHostCopyText(
  item: StorageObject,
  format: 'raw' | 'markdown' | 'html' | 'bbcode' | undefined,
  origin: string,
): string {
  const path = (item as IhostItem).publicUrl ?? ''
  const url = path.startsWith('/') ? `${origin}${path}` : path
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
