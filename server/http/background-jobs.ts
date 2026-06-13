import { zValidator } from '@hono/zod-validator'
import type { BackgroundJob } from '@shared/types'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { createBackgroundJobRequestSchema, listBackgroundJobsQuerySchema } from '../../shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { dispatchArchiveJob } from '../services/archive-jobs'
import { enqueueArchiveJob } from '../services/archive-processing'
import { BackgroundJobError } from '../usecases/ports'

const backgroundJobs = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listBackgroundJobsQuerySchema), async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No organization found' }, 404)

    const query = c.req.valid('query')
    const result = await c.get('deps').backgroundJobs.list(orgId, query)
    return c.json({ ...result, page: query.page, pageSize: query.pageSize })
  })
  .post('/', zValidator('json', createBackgroundJobRequestSchema), async (c) =>
    backgroundJobResponse(
      c,
      async () => {
        const orgId = requireOrg(c)
        const userId = c.get('userId')
        if (!userId) throw new BackgroundJobError('not_found')
        const db = c.get('platform').db
        const request = c.req.valid('json')
        const job = await enqueueArchiveJob(db, {
          orgId,
          userId,
          request,
        })
        await dispatchArchiveJob(c.get('platform'), { orgId, userId, request, jobId: job.id })
        return job
      },
      201,
    ),
  )
  .get('/:id', async (c) =>
    backgroundJobResponse(c, async () => {
      const orgId = requireOrg(c)
      return c.get('deps').backgroundJobs.get(orgId, c.req.param('id'))
    }),
  )
  .post('/:id/cancel', async (c) =>
    backgroundJobResponse(c, async () => {
      const orgId = requireOrg(c)
      return c.get('deps').backgroundJobs.cancel(orgId, c.req.param('id'))
    }),
  )
  .post('/:id/retry', async (c) =>
    backgroundJobResponse(
      c,
      async () => {
        const orgId = requireOrg(c)
        const db = c.get('platform').db
        const job = await c.get('deps').backgroundJobs.retry(orgId, c.req.param('id'))
        const request = createBackgroundJobRequestSchema.safeParse(job.metadata)
        if (request.success) {
          await dispatchArchiveJob(c.get('platform'), {
            orgId,
            userId: job.userId,
            request: request.data,
            jobId: job.id,
          })
        }
        return job
      },
      201,
    ),
  )

export default backgroundJobs

function requireOrg(c: { get(key: 'orgId'): string | null }): string {
  const orgId = c.get('orgId')
  if (!orgId) throw new BackgroundJobError('not_found')
  return orgId
}

async function backgroundJobResponse(
  c: Context<Env>,
  action: () => Promise<BackgroundJob>,
  status: 200 | 201 = 200,
): Promise<Response> {
  try {
    const job = await action()
    return c.json(job, status)
  } catch (error) {
    if (error instanceof BackgroundJobError) return c.json(errorBody(error), errorStatus(error))
    throw error
  }
}

function errorStatus(error: BackgroundJobError): 404 | 409 {
  return error.code === 'not_found' ? 404 : 409
}

function errorBody(error: BackgroundJobError): { error: string } {
  if (error.code === 'not_cancelable') return { error: 'Background job cannot be canceled' }
  if (error.code === 'not_retryable') return { error: 'Background job cannot be retried' }
  return { error: 'Not found' }
}
