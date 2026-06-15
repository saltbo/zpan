import { zValidator } from '@hono/zod-validator'
import type { BackgroundJob } from '@shared/types'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'
import { createBackgroundJobRequestSchema, listBackgroundJobsQuerySchema } from '../../shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getBackgroundJob,
  listBackgroundJobs,
  retryBackgroundJob,
} from '../usecases/background-job'
import { BackgroundJobError } from '../usecases/ports'

// The only client-driven status transition is cancellation.
const cancelJobSchema = z.object({ status: z.literal('canceled') })

const backgroundJobs = new Hono<Env>()
  .use(requireAuth)
  .get('/', zValidator('query', listBackgroundJobsQuerySchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No organization found' }, 404)

    const query = c.req.valid('query')
    const result = await listBackgroundJobs(c.get('deps'), orgId, query)
    return c.json({ ...result, page: query.page, pageSize: query.pageSize })
  })
  .post('/', zValidator('json', createBackgroundJobRequestSchema), async (c) =>
    backgroundJobResponse(
      c,
      () => {
        const orgId = requireOrg(c)
        const userId = c.get('userId')
        if (!userId) throw new BackgroundJobError('not_found')
        return createBackgroundJob(c.get('deps'), { orgId, userId, request: c.req.valid('json') })
      },
      201,
    ),
  )
  .get('/:id', async (c) =>
    backgroundJobResponse(c, () => getBackgroundJob(c.get('deps'), requireOrg(c), c.req.param('id'))),
  )
  .put('/:id/status', zValidator('json', cancelJobSchema), async (c) =>
    backgroundJobResponse(c, () => cancelBackgroundJob(c.get('deps'), requireOrg(c), c.req.param('id'))),
  )
  .post('/:id/retries', async (c) =>
    backgroundJobResponse(c, () => retryBackgroundJob(c.get('deps'), requireOrg(c), c.req.param('id')), 201),
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
