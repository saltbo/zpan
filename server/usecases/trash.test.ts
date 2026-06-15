import { DirType } from '@shared/constants'
import { describe, expect, it, vi } from 'vitest'
import type {
  ActivityRepo,
  Matter,
  MatterRepo,
  S3Gateway,
  ShareRepo,
  StorageRecord,
  StorageRepo,
  StorageUsageRepo,
} from './ports'
import { type EmptyTrashDeps, emptyTrash } from './trash'

const storage = { id: 'st-1', title: 'S3' } as StorageRecord

function file(id: string, overrides: Partial<Matter> = {}): Matter {
  return {
    id,
    orgId: 'o1',
    alias: `${id}-alias`,
    name: `${id}.txt`,
    type: 'text/plain',
    size: 100,
    dirtype: DirType.FILE,
    parent: '',
    object: `key/${id}`,
    storageId: 'st-1',
    status: 'trashed',
    trashedAt: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

const folder = (id: string): Matter => file(id, { dirtype: DirType.USER_FOLDER, size: 0, object: '' })

function makeDeps(matter: Partial<MatterRepo> = {}): {
  deps: EmptyTrashDeps
  record: ReturnType<typeof vi.fn>
  deleteObjects: ReturnType<typeof vi.fn>
  reconcile: ReturnType<typeof vi.fn>
} {
  const record = vi.fn(async () => {})
  const deleteObjects = vi.fn(async () => {})
  const reconcile = vi.fn(async () => {})
  const matterRepo: MatterRepo = {
    listTrashedRoots: async () => [],
    collectForPurge: async () => [],
    purge: async () => {},
    ...matter,
  } as unknown as MatterRepo
  const deps: EmptyTrashDeps = {
    matter: matterRepo,
    activity: { record } as unknown as ActivityRepo,
    s3: { deleteObjects } as unknown as S3Gateway,
    storages: { get: async () => storage } as unknown as StorageRepo,
    storageUsage: { reconcile } as unknown as StorageUsageRepo,
    share: { cascadeDeleteByMatter: async () => {} } as unknown as ShareRepo,
  }
  return { deps, record, deleteObjects, reconcile }
}

describe('emptyTrash', () => {
  it('returns purged 0 and records no activity when trash is empty', async () => {
    const { deps, record, deleteObjects, reconcile } = makeDeps({ listTrashedRoots: async () => [] })
    const out = await emptyTrash(deps, { orgId: 'o1', userId: 'u1' })
    expect(out).toEqual({ ok: true, purged: 0 })
    expect(record).not.toHaveBeenCalled()
    expect(deleteObjects).not.toHaveBeenCalled()
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('purges a single trashed file root: S3 delete, reconcile, and activity', async () => {
    const purge = vi.fn(async () => {})
    const { deps, record, deleteObjects, reconcile } = makeDeps({
      listTrashedRoots: async () => [file('m1')],
      collectForPurge: async () => [file('m1')],
      purge,
    })
    const out = await emptyTrash(deps, { orgId: 'o1', userId: 'u1' })
    expect(out).toEqual({ ok: true, purged: 1 })
    expect(deleteObjects).toHaveBeenCalledWith(storage, ['key/m1'])
    expect(purge).toHaveBeenCalledWith('o1', ['m1'])
    expect(reconcile).toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith({
      orgId: 'o1',
      userId: 'u1',
      action: 'trash_empty',
      targetType: 'file',
      targetName: '1 items',
      metadata: { count: 1 },
    })
  })

  it('accumulates the count across multiple trashed roots', async () => {
    const subtrees: Record<string, Matter[]> = {
      r1: [file('r1'), file('r1-child')],
      r2: [folder('r2')],
    }
    const { deps, record } = makeDeps({
      listTrashedRoots: async () => [file('r1'), folder('r2')],
      collectForPurge: async (_orgId, id) => subtrees[id as string] ?? [],
    })
    const out = await emptyTrash(deps, { orgId: 'o1', userId: 'u1' })
    expect(out).toEqual({ ok: true, purged: 3 })
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'trash_empty', targetName: '3 items', metadata: { count: 3 } }),
    )
  })

  it('skips a root whose subtree collection returns null', async () => {
    const { deps, record } = makeDeps({
      listTrashedRoots: async () => [file('gone'), file('m1')],
      collectForPurge: (async (_orgId: string, id: string) =>
        id === 'gone' ? null : [file('m1')]) as MatterRepo['collectForPurge'],
    })
    const out = await emptyTrash(deps, { orgId: 'o1', userId: 'u1' })
    expect(out).toEqual({ ok: true, purged: 1 })
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ targetName: '1 items' }))
  })

  it('purges a folder root with no S3 object without calling deleteObjects', async () => {
    const { deps, deleteObjects, record } = makeDeps({
      listTrashedRoots: async () => [folder('f1')],
      collectForPurge: async () => [folder('f1')],
    })
    const out = await emptyTrash(deps, { orgId: 'o1', userId: 'u1' })
    expect(out).toEqual({ ok: true, purged: 1 })
    expect(deleteObjects).not.toHaveBeenCalled()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'trash_empty', metadata: { count: 1 } }))
  })
})
