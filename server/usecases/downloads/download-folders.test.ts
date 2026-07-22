import { DirType } from '@shared/constants'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from '../deps'
import type { Matter, MatterRepo, StorageRepo } from '../ports'
import { NameConflictError } from '../ports'
import { assertFolderNotUsedByDownload, ensureDownloadFolderPath } from './download-folders'

const folder = (name: string, parent = ''): Matter => ({
  id: `${parent}/${name}`,
  orgId: 'org-1',
  alias: `${parent}/${name}-alias`,
  name,
  type: 'folder',
  size: 0,
  dirtype: DirType.USER_FOLDER,
  parent,
  object: '',
  storageId: 'storage-1',
  status: 'active',
  trashedAt: null,
  purgedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
})

function ensureDeps(
  overrides: {
    findActiveConflict?: MatterRepo['findActiveConflict']
    create?: MatterRepo['create']
    select?: StorageRepo['select']
  } = {},
): Pick<Deps, 'matter' | 'storages'> {
  return {
    matter: {
      findActiveConflict: overrides.findActiveConflict ?? (async () => null),
      create: overrides.create ?? (async (input) => folder(input.name, input.parent)),
    } as MatterRepo,
    storages: {
      select: overrides.select ?? (async () => ({ id: 'storage-1' }) as never),
    } as StorageRepo,
  }
}

describe('download target folders', () => {
  it('returns root without touching repositories', async () => {
    const findActiveConflict = vi.fn()
    const select = vi.fn()
    await expect(
      ensureDownloadFolderPath(ensureDeps({ findActiveConflict, select }), {
        orgId: 'org-1',
        folderPath: '',
      }),
    ).resolves.toBe('')
    expect(findActiveConflict).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it('reuses the winner when concurrent creation reports a name conflict', async () => {
    const findActiveConflict = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(folder('Downloads'))
    const create = vi.fn(async () => {
      throw new NameConflictError('Downloads', 'winner')
    })

    await expect(
      ensureDownloadFolderPath(ensureDeps({ findActiveConflict, create }), {
        orgId: 'org-1',
        folderPath: 'Downloads',
      }),
    ).resolves.toBe('Downloads')
  })

  it('reuses the winner after a database unique constraint race', async () => {
    const findActiveConflict = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(folder('Downloads'))
    const create = vi.fn(async () => {
      throw new Error('UNIQUE constraint failed: matters_active_name_uniq')
    })

    await expect(
      ensureDownloadFolderPath(ensureDeps({ findActiveConflict, create }), {
        orgId: 'org-1',
        folderPath: 'Downloads',
      }),
    ).resolves.toBe('Downloads')
  })

  it('preserves unexpected create failures and unresolved conflicts', async () => {
    const unexpected = new Error('database unavailable')
    await expect(
      ensureDownloadFolderPath(
        ensureDeps({
          create: async () => {
            throw unexpected
          },
        }),
        {
          orgId: 'org-1',
          folderPath: 'Downloads',
        },
      ),
    ).rejects.toBe(unexpected)

    const conflict = new NameConflictError('Downloads', 'winner')
    await expect(
      ensureDownloadFolderPath(
        ensureDeps({
          create: async () => {
            throw conflict
          },
        }),
        {
          orgId: 'org-1',
          folderPath: 'Downloads',
        },
      ),
    ).rejects.toBe(conflict)
  })

  it('rejects a file in the target path', async () => {
    const file = { ...folder('Downloads'), type: 'text/plain', dirtype: DirType.FILE }
    await expect(
      ensureDownloadFolderPath(ensureDeps({ findActiveConflict: async () => file }), {
        orgId: 'org-1',
        folderPath: 'Downloads/Movies',
      }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      meta: { reason: 'TARGET_FOLDER_NOT_DIRECTORY', metadata: { path: 'Downloads' } },
    })
  })

  it('skips files and rejects folders held by an active task', async () => {
    const findActiveTargetWithin = vi.fn(async () => ({ id: 'task-1', targetFolder: 'Downloads/Movies' }) as never)
    const deps = { downloadTasks: { findActiveTargetWithin } as unknown as Deps['downloadTasks'] }
    await expect(
      assertFolderNotUsedByDownload(deps, {
        orgId: 'org-1',
        folder: { ...folder('movie.mkv'), dirtype: DirType.FILE },
      }),
    ).resolves.toBeUndefined()
    expect(findActiveTargetWithin).not.toHaveBeenCalled()

    await expect(
      assertFolderNotUsedByDownload(deps, {
        orgId: 'org-1',
        folder: folder('Downloads'),
      }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      meta: {
        reason: 'DIRECTORY_IN_USE',
        metadata: { taskId: 'task-1', targetFolder: 'Downloads/Movies' },
      },
    })
  })
})
