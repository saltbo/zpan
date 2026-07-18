import { DirType, ObjectStatus } from '@shared/constants'
import { formatError } from '../../lib/errors'
import type { Deps } from '../deps'
import { AppError, type Matter, NameConflictError } from '../ports'

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function targetIsFile(path: string): AppError {
  return new AppError(409, 'Target folder path contains a file', {
    reason: 'TARGET_FOLDER_NOT_DIRECTORY',
    metadata: { path },
  })
}

export async function ensureDownloadFolderPath(
  deps: Pick<Deps, 'matter' | 'storages'>,
  params: { orgId: string; folderPath: string; actorId: string },
): Promise<string> {
  const parts = params.folderPath.split('/').filter(Boolean)
  if (parts.length === 0) return ''

  let parent = ''
  let storageId: string | null = null
  for (const name of parts) {
    const path = joinPath(parent, name)
    let existing = await deps.matter.findActiveConflict(params.orgId, parent, name)
    if (!existing) {
      storageId ??= (await deps.storages.select()).id
      try {
        existing = await deps.matter.create({
          orgId: params.orgId,
          userId: params.actorId,
          name,
          type: 'folder',
          size: 0,
          dirtype: DirType.USER_FOLDER,
          parent,
          object: '',
          storageId,
          status: ObjectStatus.ACTIVE,
        })
      } catch (error) {
        if (!(error instanceof NameConflictError) && !formatError(error).includes('UNIQUE constraint failed'))
          throw error
        existing = await deps.matter.findActiveConflict(params.orgId, parent, name)
        if (!existing) throw error
      }
    }
    if (existing.dirtype === DirType.FILE) throw targetIsFile(path)
    parent = joinPath(parent, existing.name)
  }
  return parent
}

export async function assertFolderNotUsedByDownload(
  deps: Pick<Deps, 'downloadTasks'>,
  params: { orgId: string; folder: Matter },
): Promise<void> {
  if (params.folder.dirtype === DirType.FILE) return
  const folderPath = joinPath(params.folder.parent, params.folder.name)
  const task = await deps.downloadTasks.findActiveTargetWithin(params.orgId, folderPath)
  if (!task) return
  throw new AppError(409, 'Folder is in use by a download task', {
    reason: 'DIRECTORY_IN_USE',
    metadata: { taskId: task.id, targetFolder: task.targetFolder },
  })
}
