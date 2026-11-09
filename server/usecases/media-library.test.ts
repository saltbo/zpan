import { describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { deleteMediaLibrary, scanMediaLibrary } from './media-library'
import type { MediaLibraryState } from './ports'

const requester = {
  orgId: 'org-1',
  userId: 'user-1',
  createdBy: { type: 'user' as const, ref: 'user-1', issuer: null },
}

function makeDeps(library: MediaLibraryState | null) {
  const deps = {
    mediaLibraries: { get: vi.fn(async () => library), delete: vi.fn(async () => false) },
    backgroundJobs: { create: vi.fn() },
    jobQueue: { dispatch: vi.fn() },
  }
  return { deps, typed: deps as unknown as Deps }
}

const library: MediaLibraryState = {
  id: 'lib-1',
  orgId: 'org-1',
  folderId: 'folder-1',
  folder: null,
  fingerprint: null,
  lastScannedAt: null,
  scanning: false,
  createdByUserId: 'user-1',
  createdBy: requester.createdBy,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('scanMediaLibrary', () => {
  it.each([
    [null, 404, undefined],
    [library, 409, 'MEDIA_LIBRARY_FOLDER_UNAVAILABLE'],
    [
      { ...library, folder: { path: 'Movies', name: 'Movies', trashed: true } },
      409,
      'MEDIA_LIBRARY_FOLDER_UNAVAILABLE',
    ],
  ])('rejects a rescan without queueing a job (%#)', async (state, httpStatus, reason) => {
    const { deps, typed } = makeDeps(state)

    await expect(scanMediaLibrary(typed, { ...requester, libraryId: 'lib-1' })).rejects.toMatchObject({
      httpStatus,
      meta: reason ? { reason } : {},
    })
    expect(deps.backgroundJobs.create).not.toHaveBeenCalled()
  })
})

describe('deleteMediaLibrary', () => {
  it('reports a missing library as not found', async () => {
    const { typed } = makeDeps(null)
    await expect(deleteMediaLibrary(typed, 'org-1', 'missing')).rejects.toMatchObject({ httpStatus: 404 })
  })
})
