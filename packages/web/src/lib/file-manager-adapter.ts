import type { QueryClient } from '@tanstack/react-query'
import { DirType } from '@zpan/shared/constants'
import {
  copyObject,
  createObject,
  fetchObject,
  fetchObjects,
  updateObject,
  updateObjectStatus,
  uploadToPresignedUrl,
} from './api'

export const OBJECTS_QUERY_KEY = 'objects'

export function objectsQueryKey(parent: string) {
  return [OBJECTS_QUERY_KEY, parent, 'active'] as const
}

export async function fetchFiles(parent: string) {
  return fetchObjects({ parent, status: 'active' })
}

export async function createFolder(name: string, parent: string) {
  return createObject({ name, type: '', parent, dirtype: DirType.USER_FOLDER })
}

export async function renameItem(id: string, name: string) {
  return updateObject(id, { name })
}

export async function moveItems(ids: string[], targetParent: string) {
  return Promise.all(ids.map((id) => updateObject(id, { parent: targetParent })))
}

export async function copyItem(id: string, targetParent: string) {
  return copyObject(id, targetParent)
}

export async function trashItems(ids: string[]) {
  return Promise.all(ids.map((id) => updateObjectStatus(id, 'trashed')))
}

export async function downloadFile(id: string) {
  const { downloadUrl } = await fetchObject(id)
  if (downloadUrl) {
    window.open(downloadUrl, '_blank')
  }
}

export async function uploadFile(file: File, parent: string, onProgress?: (percent: number) => void) {
  const { matter, uploadUrl } = await createObject({
    name: file.name,
    type: file.type,
    size: file.size,
    parent,
    dirtype: DirType.FILE,
  })

  if (uploadUrl) {
    await uploadToPresignedUrl(uploadUrl, file, onProgress)
    await updateObjectStatus(matter.id, 'active')
  }

  return matter
}

export function invalidateObjects(queryClient: QueryClient, parent: string) {
  queryClient.invalidateQueries({ queryKey: objectsQueryKey(parent) })
}
