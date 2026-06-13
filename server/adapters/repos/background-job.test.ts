import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../test/setup.js'
import { createBackgroundJobRepo } from './background-job'

describe('background job service', () => {
  it('creates, lists, and reads jobs with generic metadata and progress', async () => {
    const { db } = await createTestApp()
    const job = await createBackgroundJobRepo(db).create({
      orgId: 'org-service',
      userId: 'user-service',
      type: 'remote_download',
      targetFolder: 'folder-1',
      targetPath: '/downloads/file.zip',
      metadata: { sourceUrl: 'https://example.com/file.zip' },
      progress: { inputBytes: 1024, currentFilename: 'file.zip' },
    })

    const listed = await createBackgroundJobRepo(db).list('org-service', {
      type: 'remote_download',
      page: 1,
      pageSize: 10,
    })
    const loaded = await createBackgroundJobRepo(db).get('org-service', job.id)

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
    const job = await createBackgroundJobRepo(db).create({
      orgId: 'org-update',
      userId: 'user-update',
      type: 'archive_compress',
      progress: { currentFilename: 'old.txt' },
    })
    await createBackgroundJobRepo(db).update('org-update', job.id, {
      status: 'failed',
      errorMessage: 'first_failure',
      progress: { currentFilename: null },
      resultMetadata: { attempted: true },
    })

    const updated = await createBackgroundJobRepo(db).update('org-update', job.id, {
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
    const cancelable = await createBackgroundJobRepo(db).create({
      orgId: 'org-cancel',
      userId: 'user-cancel',
      type: 'archive_extract',
    })
    const blocked = await createBackgroundJobRepo(db).create({
      orgId: 'org-cancel',
      userId: 'user-cancel',
      type: 'archive_extract',
      cancelable: false,
    })

    await expect(createBackgroundJobRepo(db).cancel('org-cancel', cancelable.id)).resolves.toMatchObject({
      status: 'canceled',
    })
    await expect(createBackgroundJobRepo(db).cancel('org-cancel', blocked.id)).rejects.toMatchObject({
      code: 'not_cancelable',
    })
  })

  it('creates retries only for failed retryable jobs', async () => {
    const { db } = await createTestApp()
    const retryable = await createBackgroundJobRepo(db).create({
      orgId: 'org-retry',
      userId: 'user-retry',
      type: 'archive_extract',
      retryable: true,
    })
    const notRetryable = await createBackgroundJobRepo(db).create({
      orgId: 'org-retry',
      userId: 'user-retry',
      type: 'archive_extract',
    })
    await createBackgroundJobRepo(db).update('org-retry', retryable.id, { status: 'failed', errorMessage: 'bad_zip' })
    await createBackgroundJobRepo(db).update('org-retry', notRetryable.id, {
      status: 'failed',
      errorMessage: 'bad_zip',
    })

    const retry = await createBackgroundJobRepo(db).retry('org-retry', retryable.id)

    expect(retry).toMatchObject({ status: 'queued', retriedFromJobId: retryable.id, errorMessage: null })
    await expect(createBackgroundJobRepo(db).retry('org-retry', notRetryable.id)).rejects.toMatchObject({
      code: 'not_retryable',
    })
  })
})
