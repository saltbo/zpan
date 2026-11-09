import type { BackgroundJob } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { processMediaLibraryScan } from './media-library-scan'
import type { Matter, MediaLibraryState } from './ports'

const library: MediaLibraryState = {
  id: 'lib-1',
  orgId: 'org-1',
  folderId: 'folder-1',
  folder: { path: 'Movies', name: 'Movies', trashed: false },
  fingerprint: null,
  lastScannedAt: null,
  scanning: true,
  createdByUserId: 'user-1',
  createdBy: { type: 'user', ref: 'user-1', issuer: null },
  createdAt: new Date(),
  updatedAt: new Date(),
}

const message = {
  jobId: 'job-1',
  orgId: 'org-1',
  userId: 'user-1',
  createdBy: { type: 'user' as const, ref: 'user-1', issuer: null },
  request: { type: 'media_library_scan' as const, libraryId: 'lib-1' },
}

function makeDeps(overrides: { library?: MediaLibraryState | null; blocking?: Partial<Matter>; quota?: boolean } = {}) {
  const updates: Record<string, unknown>[] = []
  const deps = {
    backgroundJobs: {
      update: vi.fn(async (_orgId: string, _id: string, input: Record<string, unknown>) => {
        updates.push(input)
        return input as unknown as BackgroundJob
      }),
    },
    mediaLibraries: {
      get: vi.fn(async () => (overrides.library === undefined ? library : overrides.library)),
      delete: vi.fn(async () => true),
      listByOrg: vi.fn(async () => [library]),
      fingerprint: vi.fn(async () => '3:30:100:300'),
      listVideoFiles: vi.fn(async () => []),
      recordScan: vi.fn(async () => {}),
    },
    matter: {
      findActiveConflict: vi.fn(async (_orgId: string, _parent: string, name: string) =>
        overrides.blocking && name === '.zpan' ? (overrides.blocking as Matter) : null,
      ),
      create: vi.fn(async (input: Record<string, unknown>) => ({ id: `created-${input.name}`, ...input })),
    },
    storages: { select: vi.fn(async () => ({ id: 'storage-1' })) },
    s3: { putObject: vi.fn(async () => 0), deleteObject: vi.fn(async () => {}) },
    quota: { incrementUsageIfEffectiveQuotaAllows: vi.fn(async () => overrides.quota ?? true) },
    storageUsage: { rollbackReservations: vi.fn(async () => {}) },
    webdavPath: { invalidateFolders: vi.fn(async () => {}) },
  }
  return { deps, updates, typed: deps as unknown as Deps }
}

describe('processMediaLibraryScan', () => {
  it('fails the job and keeps the attempted fingerprint when another entry holds the index name', async () => {
    const { deps, typed, updates } = makeDeps({ blocking: { name: '.ZPAN', dirtype: 1 } })

    await processMediaLibraryScan(typed, message)

    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      errorMessage: '"Movies/.ZPAN" blocks the media library index',
    })
    expect(deps.mediaLibraries.recordScan).toHaveBeenCalledWith('org-1', 'lib-1', { fingerprint: '3:30:100:300' })
    expect(deps.s3.putObject).not.toHaveBeenCalled()
  })

  it('reports a quota failure for the index without writing it', async () => {
    const { deps, typed, updates } = makeDeps({ quota: false })

    await processMediaLibraryScan(typed, message)

    expect(updates.at(-1)).toMatchObject({
      status: 'failed',
      errorMessage: 'Quota exceeded for the media library index',
    })
    expect(deps.s3.putObject).not.toHaveBeenCalled()
    expect(deps.mediaLibraries.recordScan).toHaveBeenCalledWith('org-1', 'lib-1', { fingerprint: '3:30:100:300' })
  })

  it('drops the library and fails the job when its folder was purged', async () => {
    const { deps, typed, updates } = makeDeps({ library: { ...library, folder: null } })

    await processMediaLibraryScan(typed, message)

    expect(deps.mediaLibraries.delete).toHaveBeenCalledWith('org-1', 'lib-1')
    expect(updates.at(-1)).toMatchObject({ status: 'failed', errorMessage: 'Media library folder no longer exists' })
  })

  it.each([
    [null, 'Media library not found'],
    [{ ...library, folder: { path: 'Movies', name: 'Movies', trashed: true } }, 'Media library folder is in trash'],
  ])('fails without scanning when the library is unavailable (%#)', async (state, errorMessage) => {
    const { deps, typed, updates } = makeDeps({ library: state })

    await processMediaLibraryScan(typed, message)

    expect(updates.at(-1)).toMatchObject({ status: 'failed', errorMessage })
    expect(deps.mediaLibraries.fingerprint).not.toHaveBeenCalled()
  })
})
