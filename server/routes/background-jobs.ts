import { zValidator } from '@hono/zod-validator'
import type { BackgroundJob } from '@shared/types'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { listBackgroundJobsQuerySchema } from '../../shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  BackgroundJobError,
  cancelBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
  retryBackgroundJob,
} from '../services/background-jobs'

const backgroundJobs = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listBackgroundJobsQuerySchema), async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No organization found' }, 404)

    const query = c.req.valid('query')
    const result = await listBackgroundJobs(db, orgId, query)
    return c.json({ ...result, page: query.page, pageSize: query.pageSize })
  })
  .get('/:id', async (c) =>
    backgroundJobResponse(c, async () => {
      const orgId = requireOrg(c)
      return getBackgroundJob(c.get('platform').db, orgId, c.req.param('id'))
    }),
  )
  .post('/:id/cancel', async (c) =>
    backgroundJobResponse(c, async () => {
      const orgId = requireOrg(c)
      return cancelBackgroundJob(c.get('platform').db, orgId, c.req.param('id'))
    }),
  )
  .post('/:id/retry', async (c) =>
    backgroundJobResponse(
      c,
      async () => {
        const orgId = requireOrg(c)
        return retryBackgroundJob(c.get('platform').db, orgId, c.req.param('id'))
      },
      201,
    ),
  )

export default backgroundJobs

function requireOrg(c: Context<Env>): string {
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
