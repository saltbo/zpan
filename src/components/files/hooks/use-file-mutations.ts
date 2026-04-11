import { DirType } from '@shared/constants'
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

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateObject(id, { name }),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.renameSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      createObject({ name, type: 'folder', parent: currentPath, dirtype: DirType.USER_FOLDER }),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.folderCreated'))
    },
    onError: (err) => toast.error(err.message),
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
    mutationFn: ({ ids, parent }: { ids: string[]; parent: string }) => batchMoveObjects(ids, parent),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.moveSuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  const copyMutation = useMutation({
    mutationFn: ({ id, parent }: { id: string; parent: string }) => copyObject(id, parent),
    onSuccess: () => {
      invalidate()
      toast.success(t('files.copySuccess'))
    },
    onError: (err) => toast.error(err.message),
  })

  return { renameMutation, createFolderMutation, trashMutation, moveMutation, copyMutation, invalidate }
}
