import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../db/transaction', () => ({
  executeRows: vi.fn(),
  executeWriteTransactionWithResults: vi.fn(),
}))

import { executeRows, executeWriteTransactionWithResults } from '../../db/transaction'
import type { Platform } from '../../platform/interface'
import { createDownloaderBootstrapCredentialRepo } from './downloader-bootstrap'

const platform: Platform = {
  db: {} as never,
  getEnv: () => undefined,
  getBinding: () => undefined,
}

function createDb(selectRow?: Record<string, unknown> | null, consumeRows: Array<{ userId: string }> = []) {
  const selectLimit = vi.fn(async () => (selectRow ? [selectRow] : []))
  const selectWhere = vi.fn(() => ({ limit: selectLimit }))
  const selectFrom = vi.fn(() => ({ where: selectWhere }))
  const select = vi.fn(() => ({ from: selectFrom }))

  const updateAll = vi.fn(() => consumeRows)
  const updateReturning = vi.fn(() => ({ all: updateAll }))
  const updateWhere = vi.fn(() => ({ returning: updateReturning, all: updateAll }))
  const updateSet = vi.fn(() => ({ where: updateWhere }))
  const update = vi.fn(() => ({ set: updateSet }))

  const insertSelect = vi.fn(() => ({ run: vi.fn() }))
  const insertValues = vi.fn(() => ({ run: vi.fn() }))
  const insert = vi.fn(() => ({ values: insertValues, select: insertSelect }))
  const deleteWhere = vi.fn(() => ({ run: vi.fn() }))
  const deleteFn = vi.fn(() => ({ where: deleteWhere }))

  return {
    db: {
      select,
      update,
      insert,
      delete: deleteFn,
    } as never,
    selectLimit,
    updateAll,
    insertSelect,
    insertValues,
    deleteWhere,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(executeRows).mockImplementation(async (query) => ('all' in query ? query.all() : []))
})

describe('createDownloaderBootstrapCredentialRepo', () => {
  it('stores a hashed bootstrap credential for later registration', async () => {
    const { db, insertValues } = createDb()
    const hashDownloadToken = vi.fn(async () => 'hashed-token')
    const repo = createDownloaderBootstrapCredentialRepo(db, { hashDownloadToken })

    await repo.issue({
      platform,
      token: 'bootstrap-token',
      userId: 'user-1',
      deviceCode: 'device-code-1',
      expiresAt: new Date('2026-07-29T13:00:00.000Z'),
    })

    expect(hashDownloadToken).toHaveBeenCalledWith(platform, 'bootstrap-token')
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: 'hashed-token',
        userId: 'user-1',
        deviceCode: 'device-code-1',
        clientId: 'zpan-cli',
        scope: 'downloader:register',
        expiresAt: new Date('2026-07-29T13:00:00.000Z'),
        createdAt: expect.any(Date),
      }),
    )
  })

  it('returns null when resolve does not find a matching credential', async () => {
    const { db } = createDb(null)
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(repo.resolve(platform, 'bootstrap-token', new Date('2026-07-29T12:00:00.000Z'))).resolves.toBeNull()
  })

  it('marks consumed credentials as inactive when resolved', async () => {
    const { db } = createDb({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      expiresAt: new Date('2026-07-29T13:00:00.000Z'),
      consumedAt: new Date('2026-07-29T12:30:00.000Z'),
    })
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(repo.resolve(platform, 'bootstrap-token', new Date('2026-07-29T12:00:00.000Z'))).resolves.toEqual({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      active: false,
    })
  })

  it('marks expired credentials as inactive when resolved', async () => {
    const { db } = createDb({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      expiresAt: new Date('2026-07-29T11:59:59.000Z'),
      consumedAt: null,
    })
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(repo.resolve(platform, 'bootstrap-token', new Date('2026-07-29T12:00:00.000Z'))).resolves.toEqual({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      active: false,
    })
  })

  it('returns null when consume cannot update an active credential', async () => {
    const { db } = createDb(null, [])
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(repo.consume(platform, 'bootstrap-token', new Date('2026-07-29T12:00:00.000Z'))).resolves.toBeNull()
  })

  it('returns the consumed credential metadata when consume succeeds', async () => {
    const { db } = createDb(null, [{ userId: 'user-1' }])
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(repo.consume(platform, 'bootstrap-token', new Date('2026-07-29T12:00:00.000Z'))).resolves.toEqual({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      active: false,
    })
  })

  it('returns true when downloader registration consumes exactly one credential', async () => {
    const { db, insertSelect, deleteWhere } = createDb(null, [{ userId: 'user-1' }])
    vi.mocked(executeWriteTransactionWithResults).mockImplementation(async (_db, queries) => [
      undefined,
      queries[1].all?.(),
      undefined,
    ])
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(
      repo.registerDownloader({
        platform,
        token: 'bootstrap-token',
        now: new Date('2026-07-29T12:00:00.000Z'),
        downloader: {
          id: 'downloader-1',
          name: 'Bootstrap downloader',
          tokenHash: 'downloader-hash',
          tokenJti: 'token-jti',
          version: '1.2.3',
          hostname: 'bootstrap-edge',
          platform: 'linux',
          arch: 'amd64',
          engine: 'aria2',
          capabilities: ['http'],
          maxConcurrentTasks: 2,
          currentTasks: 0,
          downloadBps: 0,
          uploadBps: 0,
          freeDiskBytes: 4096,
          remoteDownloadCreditUnitBytes: 104857600,
          createdBy: 'user-1',
          now: new Date('2026-07-29T12:00:00.000Z'),
        },
      }),
    ).resolves.toBe(true)

    expect(executeWriteTransactionWithResults).toHaveBeenCalledWith(db, expect.any(Array), [1])
    expect(insertSelect).toHaveBeenCalled()
    expect(deleteWhere).toHaveBeenCalled()
  })

  it('returns false when downloader registration does not consume a credential', async () => {
    const { db } = createDb()
    vi.mocked(executeWriteTransactionWithResults).mockImplementation(async (_db, queries) => {
      const consumed = queries[1].all?.()
      return [undefined, Array.isArray(consumed) ? [] : consumed, undefined]
    })
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: vi.fn(async () => 'hashed-token'),
    })

    await expect(
      repo.registerDownloader({
        platform,
        token: 'bootstrap-token',
        now: new Date('2026-07-29T12:00:00.000Z'),
        downloader: {
          id: 'downloader-1',
          name: 'Bootstrap downloader',
          tokenHash: 'downloader-hash',
          tokenJti: 'token-jti',
          version: '1.2.3',
          hostname: 'bootstrap-edge',
          platform: 'linux',
          arch: 'amd64',
          engine: 'aria2',
          capabilities: ['http'],
          maxConcurrentTasks: 2,
          currentTasks: 0,
          downloadBps: 0,
          uploadBps: 0,
          freeDiskBytes: 4096,
          remoteDownloadCreditUnitBytes: 104857600,
          createdBy: 'user-1',
          now: new Date('2026-07-29T12:00:00.000Z'),
        },
      }),
    ).resolves.toBe(false)
  })
})
