import { describe, expect, it } from 'vitest'
import { createTestApp } from '../test/setup.js'
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
  retryBackgroundJob,
  updateBackgroundJob,
} from './background-jobs'

describe('background job service', () => {
  it('creates, lists, and reads jobs with generic metadata and progress', async () => {
    const { db } = await createTestApp()
    const job = await createBackgroundJob(db, {
      orgId: 'org-service',
      userId: 'user-service',
      type: 'remote_download',
      targetFolder: 'folder-1',
      targetPath: '/downloads/file.zip',
      metadata: { sourceUrl: 'https://example.com/file.zip' },
      progress: { inputBytes: 1024, currentFilename: 'file.zip' },
    })

    const listed = await listBackgroundJobs(db, 'org-service', { type: 'remote_download', page: 1, pageSize: 10 })
    const loaded = await getBackgroundJob(db, 'org-service', job.id)

    expect(listed).toMatchObject({ total: 1, items: [{ id: job.id }] })
    expect(loaded).toMatchObject({
      id: job.id,
      type: 'remote_download',
      targetFolder: 'folder-1',
      targetPath: '/downloads/file.zip',
      metadata: { sourceUrl: 'https://example.com/file.zip' },
      progress: { inputBytes: 1024, currentFilename: 'file.zip' },
    })
  })

  it('updates nullable fields and terminal timestamps explicitly', async () => {
    const { db } = await createTestApp()
    const job = await createBackgroundJob(db, {
      orgId: 'org-update',
      userId: 'user-update',
      type: 'archive_compress',
      progress: { currentFilename: 'old.txt' },
    })
    await updateBackgroundJob(db, 'org-update', job.id, {
      status: 'failed',
      errorMessage: 'first_failure',
      progress: { currentFilename: null },
      resultMetadata: { attempted: true },
    })

    const updated = await updateBackgroundJob(db, 'org-update', job.id, {
      errorMessage: null,
      resultMetadata: null,
    })

    expect(updated.status).toBe('failed')
    expect(updated.finishedAt).not.toBeNull()
    expect(updated.errorMessage).toBeNull()
    expect(updated.resultMetadata).toBeNull()
    expect(updated.progress.currentFilename).toBeNull()
  })

  it('cancels active cancelable jobs and rejects unsupported cancellation', async () => {
    const { db } = await createTestApp()
    const cancelable = await createBackgroundJob(db, {
      orgId: 'org-cancel',
      userId: 'user-cancel',
      type: 'archive_extract',
    })
    const blocked = await createBackgroundJob(db, {
      orgId: 'org-cancel',
      userId: 'user-cancel',
      type: 'archive_extract',
      cancelable: false,
    })

    await expect(cancelBackgroundJob(db, 'org-cancel', cancelable.id)).resolves.toMatchObject({ status: 'canceled' })
    await expect(cancelBackgroundJob(db, 'org-cancel', blocked.id)).rejects.toMatchObject({ code: 'not_cancelable' })
  })

  it('creates retries only for failed retryable jobs', async () => {
    const { db } = await createTestApp()
    const retryable = await createBackgroundJob(db, {
      orgId: 'org-retry',
      userId: 'user-retry',
      type: 'archive_extract',
      retryable: true,
    })
    const notRetryable = await createBackgroundJob(db, {
      orgId: 'org-retry',
      userId: 'user-retry',
      type: 'archive_extract',
    })
    await updateBackgroundJob(db, 'org-retry', retryable.id, { status: 'failed', errorMessage: 'bad_zip' })
    await updateBackgroundJob(db, 'org-retry', notRetryable.id, { status: 'failed', errorMessage: 'bad_zip' })

    const retry = await retryBackgroundJob(db, 'org-retry', retryable.id)

    expect(retry).toMatchObject({ status: 'queued', retriedFromJobId: retryable.id, errorMessage: null })
    await expect(retryBackgroundJob(db, 'org-retry', notRetryable.id)).rejects.toMatchObject({
      code: 'not_retryable',
    })
  })
})
