import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getBackgroundJob,
  updateBackgroundJob,
} from '../services/background-jobs'
import { authedHeaders, createTestApp } from '../test/setup.js'

type TestDb = Awaited<ReturnType<typeof createTestApp>>['db']

type UserOrg = {
  userId: string
  orgId: string
}

async function getUserOrg(db: TestDb, email: string): Promise<UserOrg> {
  const rows = await db.all<UserOrg>(sql`
    SELECT u.id AS userId, m.organization_id AS orgId
    FROM user u
    INNER JOIN member m ON m.user_id = u.id
    WHERE u.email = ${email}
    LIMIT 1
  `)
  if (!rows[0]) throw new Error(`No user org found for ${email}`)
  return rows[0]
}

describe('background jobs API', () => {
  it('lists current org jobs with status/type filters and pagination', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-list@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-list@example.com')
    await createBackgroundJob(db, { orgId, userId, type: 'archive_compress' })
    const running = await createBackgroundJob(db, { orgId, userId, type: 'archive_extract' })
    await updateBackgroundJob(db, orgId, running.id, { status: 'running' })

    const res = await app.request('/api/background-jobs?status=running&type=archive_extract&page=1&pageSize=1', {
      headers,
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
      items: [{ id: running.id, orgId, type: 'archive_extract', status: 'running' }],
    })
  })

  it('rejects detail access across organizations', async () => {
    const { app, db } = await createTestApp()
    await authedHeaders(app, 'jobs-owner@example.com')
    const viewerHeaders = await authedHeaders(app, 'jobs-viewer@example.com')
    const owner = await getUserOrg(db, 'jobs-owner@example.com')
    const job = await createBackgroundJob(db, { orgId: owner.orgId, userId: owner.userId, type: 'archive_compress' })

    const res = await app.request(`/api/background-jobs/${job.id}`, { headers: viewerHeaders })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Not found' })
  })

  it('cancels only queued or running jobs', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-cancel@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-cancel@example.com')
    const queued = await createBackgroundJob(db, { orgId, userId, type: 'archive_compress' })
    const completed = await createBackgroundJob(db, { orgId, userId, type: 'archive_extract' })
    await updateBackgroundJob(db, orgId, completed.id, { status: 'completed' })

    const canceledRes = await app.request(`/api/background-jobs/${queued.id}/cancel`, { method: 'POST', headers })
    const rejectedRes = await app.request(`/api/background-jobs/${completed.id}/cancel`, { method: 'POST', headers })

    expect(canceledRes.status).toBe(200)
    await expect(canceledRes.json()).resolves.toMatchObject({ id: queued.id, status: 'canceled' })
    expect(rejectedRes.status).toBe(409)
    await expect(rejectedRes.json()).resolves.toEqual({ error: 'Background job cannot be canceled' })
  })

  it('retries only failed retryable jobs without hiding the failed job', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-retry@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-retry@example.com')
    const retryable = await createBackgroundJob(db, {
      orgId,
      userId,
      type: 'archive_extract',
      targetPath: '/imports/archive.zip',
      retryable: true,
    })
    const notFailed = await createBackgroundJob(db, { orgId, userId, type: 'archive_compress', retryable: true })
    await updateBackgroundJob(db, orgId, retryable.id, {
      status: 'failed',
      errorMessage: 'zip_crc_error',
      progress: { inputBytes: 128, fileCount: 4 },
    })

    const retryRes = await app.request(`/api/background-jobs/${retryable.id}/retry`, { method: 'POST', headers })
    const rejectedRes = await app.request(`/api/background-jobs/${notFailed.id}/retry`, { method: 'POST', headers })

    expect(retryRes.status).toBe(201)
    const retried = (await retryRes.json()) as { id: string; retriedFromJobId: string; status: string }
    expect(retried).toMatchObject({ retriedFromJobId: retryable.id, status: 'queued' })
    expect(retried.id).not.toBe(retryable.id)
    expect(rejectedRes.status).toBe(409)
    await expect(rejectedRes.json()).resolves.toEqual({ error: 'Background job cannot be retried' })

    const original = await getBackgroundJob(db, orgId, retryable.id)
    expect(original).toMatchObject({ status: 'failed', errorMessage: 'zip_crc_error', retriedFromJobId: null })
    await expect(cancelBackgroundJob(db, orgId, retryable.id)).rejects.toMatchObject({ code: 'not_cancelable' })
  })

  it('lets non-domain service errors surface at the route boundary', async () => {
    const { app, db } = await createTestApp()
    const headers = await authedHeaders(app, 'jobs-invalid-json@example.com')
    const { orgId, userId } = await getUserOrg(db, 'jobs-invalid-json@example.com')
    const job = await createBackgroundJob(db, { orgId, userId, type: 'archive_compress' })
    await db.run(sql`UPDATE background_jobs SET metadata = '{invalid-json' WHERE id = ${job.id}`)

    const res = await app.request(`/api/background-jobs/${job.id}`, { headers })

    expect(res.status).toBe(500)
  })
})
