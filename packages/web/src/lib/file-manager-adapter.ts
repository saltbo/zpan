import type { IApi, IEntity, TID } from '@svar-ui/react-filemanager'
import { DirType } from '@zpan/shared/constants'
import type { StorageObject } from '@zpan/shared/types'
import {
  confirmUpload,
  copyObject,
  createObject,
  deleteObject,
  getObject,
  listObjects,
  updateObject,
  uploadToS3,
} from './api'

// SVAR uses path-based IDs (e.g. "/Music/song.mp3").
// ZPan uses database IDs. This class manages the bidirectional mapping.
class PathMapper {
  private pathToDb = new Map<string, string>()
  private dbToPath = new Map<string, string>()

  register(path: string, dbId: string) {
    this.pathToDb.set(path, dbId)
    this.dbToPath.set(dbId, path)
  }

  toDbId(path: string): string {
    if (path === '/') return ''
    const dbId = this.pathToDb.get(path)
    if (!dbId) throw new Error(`No DB mapping for path: ${path}`)
    return dbId
  }

  toPath(dbId: string): string | undefined {
    return this.dbToPath.get(dbId)
  }

  remove(path: string) {
    const dbId = this.pathToDb.get(path)
    this.pathToDb.delete(path)
    if (dbId) this.dbToPath.delete(dbId)
  }

  rename(oldPath: string, newPath: string) {
    const dbId = this.pathToDb.get(oldPath)
    if (!dbId) return
    this.pathToDb.delete(oldPath)
    this.pathToDb.set(newPath, dbId)
    this.dbToPath.set(dbId, newPath)
  }
}

const mapper = new PathMapper()

export function pathToDbId(path: string): string {
  return mapper.toDbId(path)
}

function buildPath(parentPath: string, name: string): string {
  return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`
}

function parentOfPath(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

function toEntity(obj: StorageObject, parentPath: string): IEntity {
  const path = buildPath(parentPath, obj.name)
  mapper.register(path, obj.id)
  return {
    id: path,
    name: obj.name,
    size: obj.size,
    date: new Date(obj.updatedAt),
    type: obj.dirtype === DirType.FILE ? 'file' : 'folder',
    lazy: obj.dirtype !== DirType.FILE,
  }
}

export async function loadFolder(dbParentId: string, parentPath: string): Promise<IEntity[]> {
  const res = await listObjects(dbParentId)
  return res.items.map((obj) => toEntity(obj, parentPath))
}

export function refreshFolder(api: IApi, dbParentId: string, parentPath: string): Promise<void> {
  return loadFolder(dbParentId, parentPath).then((entities) => {
    api.exec('provide-data', { id: parentPath, data: entities, skipProvider: true })
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
    const pathId = ev.id as string
    const dbId = mapper.toDbId(pathId)
    const data = await loadFolder(dbId, pathId)
    api.exec('provide-data', { id: pathId, data, skipProvider: true })
    return false
  })

  api.intercept('rename-file', async (ev: { id: TID; name: string }) => {
    const pathId = ev.id as string
    const dbId = mapper.toDbId(pathId)
    await updateObject(dbId, { name: ev.name })
    const newPath = buildPath(parentOfPath(pathId), ev.name)
    mapper.rename(pathId, newPath)
  })

  api.intercept('create-file', async (ev: { file: { name: string; type?: string }; parent: TID }) => {
    if (ev.file.type === 'folder') {
      const parentPath = ev.parent as string
      const parentDbId = mapper.toDbId(parentPath)
      const created = await createObject({
        name: ev.file.name,
        type: 'folder',
        parent: parentDbId,
        dirtype: DirType.USER_FOLDER,
      })
      const newPath = buildPath(parentPath, ev.file.name)
      mapper.register(newPath, created.id)
      return { newId: newPath }
    }
  })

  api.intercept('delete-files', async (ev: { ids: TID[] }) => {
    const paths = ev.ids as string[]
    const dbIds = paths.map((p) => mapper.toDbId(p))
    await settledAll(dbIds as TID[], deleteObject)
    for (const p of paths) mapper.remove(p)
  })

  api.intercept('move-files', async (ev: { ids: TID[]; target: TID }) => {
    const targetPath = ev.target as string
    const targetDbId = mapper.toDbId(targetPath)
    const paths = ev.ids as string[]
    const dbIds = paths.map((p) => mapper.toDbId(p))
    const moved = await settledAll(dbIds as TID[], (id) => updateObject(id, { parent: targetDbId }))
    const newIds = moved.map((m, i) => {
      const newPath = buildPath(targetPath, m.name)
      mapper.rename(paths[i], newPath)
      return newPath
    })
    return { newIds }
  })

  api.intercept('copy-files', async (ev: { ids: TID[]; target: TID }) => {
    const targetPath = ev.target as string
    const targetDbId = mapper.toDbId(targetPath)
    const dbIds = (ev.ids as string[]).map((p) => mapper.toDbId(p))
    const copies = await settledAll(dbIds as TID[], (id) => copyObject(id, targetDbId))
    const newIds = copies.map((c) => {
      const newPath = buildPath(targetPath, c.name)
      mapper.register(newPath, c.id)
      return newPath
    })
    return { newIds }
  })

  api.intercept('download-file', async (ev: { id: TID }) => {
    const dbId = mapper.toDbId(ev.id as string)
    const obj = await getObject(dbId)
    if (obj.downloadUrl) {
      window.open(obj.downloadUrl, '_blank', 'noopener,noreferrer')
    }
    return false
  })

  api.intercept('upload', async (ev: { to: TID; files: File[] }) => {
    const parentPath = (ev.to as string) || '/'
    const parentDbId = mapper.toDbId(parentPath)
    const newIds: string[] = []
    for (const file of ev.files) {
      const matter = await createObject({
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        parent: parentDbId,
        dirtype: DirType.FILE,
      })
      if (matter.uploadUrl) {
        await uploadToS3(matter.uploadUrl, file)
        await confirmUpload(matter.id)
      }
      const newPath = buildPath(parentPath, file.name)
      mapper.register(newPath, matter.id)
      newIds.push(newPath)
    }
    return { newIds }
  })
}
