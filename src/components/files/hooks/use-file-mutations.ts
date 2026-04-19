import { DirType } from '@shared/constants'
import type { ConflictStrategy } from '@shared/schemas'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { batchMoveObjects, batchTrashObjects, copyObject, createObject, updateObject } from '@/lib/api'

export function useFileMutations(currentPath: string) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['objects', 'active', 'path', currentPath] })
    queryClient.invalidateQueries({ queryKey: ['user', 'quota'] })
  }

  // onError is intentionally omitted on mutations that may surface name conflicts:
  // the caller wraps them with the conflict resolver and shows a dialog instead of
  // a toast. Other failures still reach the caller via throw → React Query's default.

  const renameMutation = useMutation({
    mutationFn: ({ id, name, onConflict }: { id: string; name: string; onConflict?: ConflictStrategy }) =>
      updateObject(id, { name, onConflict }),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.renameSuccess'))
    },
  })

  const createFolderMutation = useMutation({
    mutationFn: ({ name, onConflict }: { name: string; onConflict?: ConflictStrategy }) =>
      createObject({ name, type: 'folder', parent: currentPath, dirtype: DirType.USER_FOLDER, onConflict }),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.folderCreated'))
    },
  })

  const trashMutation = useMutation({
    mutationFn: (ids: string[]) => batchTrashObjects(ids),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.trashSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const moveMutation = useMutation({
    mutationFn: ({ ids, parent, onConflict }: { ids: string[]; parent: string; onConflict?: ConflictStrategy }) =>
      batchMoveObjects(ids, parent, onConflict),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.moveSuccess'))
    },
  })

  const copyMutation = useMutation({
    mutationFn: ({ id, parent, onConflict }: { id: string; parent: string; onConflict?: ConflictStrategy }) =>
      copyObject(id, parent, onConflict),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.copySuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  return { renameMutation, createFolderMutation, trashMutation, moveMutation, copyMutation, invalidate }
}
