import type { CreateBackgroundJobRequest } from '@shared/schemas'
import type { BackgroundJob } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
  retryBackgroundJob,
} from './background-job'
import type { Deps } from './deps'
import { type ArchiveJobMessage, type ArchiveJobsGateway, BackgroundJobError, type BackgroundJobRepo } from './ports'

const sampleJob = {
  id: 'job-1',
  orgId: 'org-1',
  userId: 'user-1',
  type: 'archive_extract',
  status: 'queued',
  metadata: null,
} as BackgroundJob

const extractRequest: CreateBackgroundJobRequest = { type: 'archive_extract', matterId: 'm-1' }

// Fake ports as plain objects. backgroundJobs.create is what enqueueArchiveJob
// (the real composed function) drives on create; everything else is forwarded.
function makeDeps(
  overrides: { backgroundJobs?: Partial<BackgroundJobRepo>; dispatch?: ArchiveJobsGateway['dispatch'] } = {},
) {
  const backgroundJobs: BackgroundJobRepo = {
    create: vi.fn(async () => sampleJob),
    list: vi.fn(async () => ({ items: [], total: 0 })),
    get: vi.fn(async () => sampleJob),
    update: vi.fn(async () => sampleJob),
    cancel: vi.fn(async () => sampleJob),
    retry: vi.fn(async () => sampleJob),
    ...overrides.backgroundJobs,
  }
  const dispatch = vi.fn(overrides.dispatch ?? (async () => {}))
  const deps = { backgroundJobs, archiveJobs: { dispatch } } as unknown as Deps
  return { deps, backgroundJobs, dispatch }
}

beforeEach(() => vi.clearAllMocks())

describe('background-job usecase', () => {
  describe('listBackgroundJobs', () => {
    it('forwards the repo result and options', async () => {
      const list = vi.fn(async () => ({ items: [sampleJob], total: 1 }))
      const { deps } = makeDeps({ backgroundJobs: { list } })
      const opts = { status: 'queued' as const, type: 'archive_extract', page: 2, pageSize: 5 }
      expect(await listBackgroundJobs(deps, 'org-1', opts)).toEqual({ items: [sampleJob], total: 1 })
      expect(list).toHaveBeenCalledWith('org-1', opts)
    })
  })

  describe('getBackgroundJob', () => {
    it('forwards the repo result', async () => {
      const get = vi.fn(async () => sampleJob)
      const { deps } = makeDeps({ backgroundJobs: { get } })
      expect(await getBackgroundJob(deps, 'org-1', 'job-1')).toBe(sampleJob)
      expect(get).toHaveBeenCalledWith('org-1', 'job-1')
    })

    it('propagates BackgroundJobError thrown by the repo', async () => {
      const get = vi.fn(async () => {
        throw new BackgroundJobError('not_found')
      })
      const { deps } = makeDeps({ backgroundJobs: { get } })
      await expect(getBackgroundJob(deps, 'org-1', 'missing')).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  describe('cancelBackgroundJob', () => {
    it('forwards the repo result', async () => {
      const canceled = { ...sampleJob, status: 'canceled' } as BackgroundJob
      const cancel = vi.fn(async () => canceled)
      const { deps } = makeDeps({ backgroundJobs: { cancel } })
      expect(await cancelBackgroundJob(deps, 'org-1', 'job-1')).toBe(canceled)
      expect(cancel).toHaveBeenCalledWith('org-1', 'job-1')
    })

    it('propagates BackgroundJobError when not cancelable', async () => {
      const cancel = vi.fn(async () => {
        throw new BackgroundJobError('not_cancelable')
      })
      const { deps } = makeDeps({ backgroundJobs: { cancel } })
      await expect(cancelBackgroundJob(deps, 'org-1', 'job-1')).rejects.toMatchObject({ code: 'not_cancelable' })
    })
  })

  describe('createBackgroundJob', () => {
    it('enqueues the request then dispatches the job, and returns it', async () => {
      const create = vi.fn(async () => sampleJob)
      const { deps, dispatch } = makeDeps({ backgroundJobs: { create } })
      const job = await createBackgroundJob(deps, { orgId: 'org-1', userId: 'user-1', request: extractRequest })

      expect(job).toBe(sampleJob)
      // enqueueArchiveJob maps the request onto the create input.
      expect(create).toHaveBeenCalledWith({
        orgId: 'org-1',
        userId: 'user-1',
        type: 'archive_extract',
        targetFolder: null,
        metadata: extractRequest,
        cancelable: false,
      })
      expect(dispatch).toHaveBeenCalledWith({
        orgId: 'org-1',
        userId: 'user-1',
        request: extractRequest,
        jobId: 'job-1',
      } satisfies ArchiveJobMessage)
    })

    it('dispatches only after the job is enqueued', async () => {
      const calls: string[] = []
      const create = vi.fn(async () => {
        calls.push('create')
        return sampleJob
      })
      const dispatch = vi.fn(async () => {
        calls.push('dispatch')
      })
      const { deps } = makeDeps({ backgroundJobs: { create }, dispatch })
      await createBackgroundJob(deps, { orgId: 'org-1', userId: 'user-1', request: extractRequest })
      expect(calls).toEqual(['create', 'dispatch'])
    })

    it('carries an explicit targetFolder onto the enqueue input', async () => {
      const create = vi.fn(async () => sampleJob)
      const { deps } = makeDeps({ backgroundJobs: { create } })
      const request: CreateBackgroundJobRequest = { type: 'archive_extract', matterId: 'm-1', targetFolder: 'dest' }
      await createBackgroundJob(deps, { orgId: 'org-1', userId: 'user-1', request })
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ targetFolder: 'dest', metadata: request }))
    })
  })

  describe('retryBackgroundJob', () => {
    it('retries and redispatches when the stored metadata is a valid request', async () => {
      const retriedJob = { ...sampleJob, id: 'job-2', userId: 'owner-9', metadata: extractRequest } as BackgroundJob
      const retry = vi.fn(async () => retriedJob)
      const { deps, dispatch } = makeDeps({ backgroundJobs: { retry } })

      const out = await retryBackgroundJob(deps, 'org-1', 'job-1')

      expect(out).toBe(retriedJob)
      expect(retry).toHaveBeenCalledWith('org-1', 'job-1')
      // Dispatch uses the retried job's own owner and id, parsed from metadata.
      expect(dispatch).toHaveBeenCalledWith({
        orgId: 'org-1',
        userId: 'owner-9',
        request: extractRequest,
        jobId: 'job-2',
      } satisfies ArchiveJobMessage)
    })

    it('does not dispatch when the stored metadata is not a valid request', async () => {
      const retriedJob = { ...sampleJob, metadata: { not: 'a request' } } as BackgroundJob
      const retry = vi.fn(async () => retriedJob)
      const { deps, dispatch } = makeDeps({ backgroundJobs: { retry } })

      const out = await retryBackgroundJob(deps, 'org-1', 'job-1')

      expect(out).toBe(retriedJob)
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('does not dispatch when the stored metadata is null', async () => {
      const retry = vi.fn(async () => ({ ...sampleJob, metadata: null }) as BackgroundJob)
      const { deps, dispatch } = makeDeps({ backgroundJobs: { retry } })
      await retryBackgroundJob(deps, 'org-1', 'job-1')
      expect(dispatch).not.toHaveBeenCalled()
    })

    it('propagates BackgroundJobError when the job is not retryable', async () => {
      const retry = vi.fn(async () => {
        throw new BackgroundJobError('not_retryable')
      })
      const { deps, dispatch } = makeDeps({ backgroundJobs: { retry } })
      await expect(retryBackgroundJob(deps, 'org-1', 'job-1')).rejects.toMatchObject({ code: 'not_retryable' })
      expect(dispatch).not.toHaveBeenCalled()
    })
  })
})
