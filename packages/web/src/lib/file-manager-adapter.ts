import type { IApi, IEntity, TID } from '@svar-ui/react-filemanager'
import { DirType } from '@zpan/shared/constants'
import type { StorageObject } from '@zpan/shared/types'
import { copyObject, createObject, deleteObject, getObject, listObjects, updateObject } from './api'

function toEntity(obj: StorageObject): IEntity {
  return {
    id: obj.id,
    name: obj.name,
    size: obj.size,
    date: new Date(obj.updatedAt),
    type: obj.dirtype === DirType.FILE ? 'file' : 'folder',
    lazy: obj.dirtype !== DirType.FILE,
    _alias: obj.alias,
    _status: obj.status,
    _parent: obj.parent,
  }
}

export async function loadFolder(parent: string): Promise<IEntity[]> {
  const res = await listObjects(parent)
  return res.items.map(toEntity)
}

export function refreshFolder(api: IApi, parent: string): Promise<void> {
  return loadFolder(parent).then((entities) => {
    api.exec('provide-data', { id: parent, data: entities, skipProvider: true })
  })
}

async function settledAll<T>(ids: TID[], fn: (id: string) => Promise<T>): Promise<T[]> {
  const results = await Promise.allSettled(ids.map((id) => fn(id as string)))
  const failures = results.filter((r) => r.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(`${failures.length} operation(s) failed`)
  }
  return results.map((r) => (r as PromiseFulfilledResult<T>).value)
}

export function connectAdapter(api: IApi) {
  api.intercept('request-data', async (ev: { id: TID }) => {
    const data = await loadFolder(ev.id as string)
    api.exec('provide-data', { id: ev.id, data, skipProvider: true })
    return false
  })

  api.intercept('rename-file', async (ev: { id: TID; name: string }) => {
    await updateObject(ev.id as string, { name: ev.name })
  })

  api.intercept('create-file', async (ev: { file: { name: string; type?: string }; parent: TID }) => {
    if (ev.file.type === 'folder') {
      const created = await createObject({
        name: ev.file.name,
        type: 'folder',
        parent: ev.parent as string,
        dirtype: DirType.USER_FOLDER,
      })
      return { newId: created.id }
    }
  })

  api.intercept('delete-files', async (ev: { ids: TID[] }) => {
    await settledAll(ev.ids, deleteObject)
  })

  api.intercept('move-files', async (ev: { ids: TID[]; target: TID }) => {
    const moved = await settledAll(ev.ids, (id) => updateObject(id, { parent: ev.target as string }))
    return { newIds: moved.map((m) => m.id) }
  })

  api.intercept('copy-files', async (ev: { ids: TID[]; target: TID }) => {
    const copies = await settledAll(ev.ids, (id) => copyObject(id, ev.target as string))
    return { newIds: copies.map((c) => c.id) }
  })

  api.intercept('download-file', async (ev: { id: TID }) => {
    const obj = await getObject(ev.id as string)
    if (obj.downloadUrl) {
      window.open(obj.downloadUrl, '_blank', 'noopener,noreferrer')
    }
    return false
  })
}
