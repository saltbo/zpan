import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { createBackgroundJobRequestSchema, listBackgroundJobsQuerySchema, pageSchema } from '../../shared/schemas'
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
import { apiError, errorResponse, jsonBody, jsonContent } from './openapi'

// BackgroundJob is already wire-shaped (ISO string timestamps) — no DTO mapper.
const backgroundJobProgressSchema = z.object({
  inputBytes: z.number().int(),
  outputBytes: z.number().int(),
  processedBytes: z.number().int(),
  fileCount: z.number().int(),
  currentFilename: z.string().nullable(),
})

const backgroundJobSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    userId: z.string(),
    type: z.string(),
    status: z.string(),
    targetFolder: z.string().nullable(),
    targetPath: z.string().nullable(),
    metadata: z.record(z.string(), z.any()).nullable(),
    progress: backgroundJobProgressSchema,
    errorMessage: z.string().nullable(),
    resultMetadata: z.record(z.string(), z.any()).nullable(),
    retryable: z.boolean(),
    cancelable: z.boolean(),
    retriedFromJobId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .openapi('BackgroundJob')

const backgroundJobPageSchema = pageSchema(backgroundJobSchema, 'BackgroundJobPage')

// The only client-driven status transition is cancellation.
const cancelJobSchema = z.object({ status: z.literal('canceled') })

// A missing org/job throws BackgroundJobError('not_found'); a bad transition throws
// not_cancelable/not_retryable. The global onError maps them to 404 / 409.
function requireOrg(c: { get(key: 'orgId'): string | null }): string {
  const orgId = c.get('orgId')
  if (!orgId) throw new BackgroundJobError('not_found')
  return orgId
}

const listRoute = createRoute({
  operationId: 'listBackgroundJobs',
  summary: 'List background jobs',
  tags: ['Background Jobs'],
  method: 'get',
  path: '/',
  request: { query: listBackgroundJobsQuerySchema },
  responses: {
    200: jsonContent(backgroundJobPageSchema, 'Background jobs'),
    404: errorResponse('No organization found'),
  },
})

const createJobRoute = createRoute({
  operationId: 'createBackgroundJob',
  summary: 'Create background job',
  tags: ['Background Jobs'],
  method: 'post',
  path: '/',
  request: jsonBody(createBackgroundJobRequestSchema),
  responses: {
    201: jsonContent(backgroundJobSchema, 'Created background job'),
    404: errorResponse('Not found'),
  },
})

const getJobRoute = createRoute({
  operationId: 'getBackgroundJob',
  summary: 'Get background job',
  tags: ['Background Jobs'],
  method: 'get',
  path: '/{id}',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(backgroundJobSchema, 'Background job'),
    404: errorResponse('Not found'),
  },
})

const cancelJobRoute = createRoute({
  operationId: 'cancelBackgroundJob',
  summary: 'Cancel background job',
  tags: ['Background Jobs'],
  method: 'put',
  path: '/{id}/status',
  request: { params: z.object({ id: z.string() }), ...jsonBody(cancelJobSchema) },
  responses: {
    200: jsonContent(backgroundJobSchema, 'Canceled background job'),
    404: errorResponse('Not found'),
    409: errorResponse('Background job cannot be canceled'),
  },
})

const retryJobRoute = createRoute({
  operationId: 'retryBackgroundJob',
  summary: 'Retry background job',
  tags: ['Background Jobs'],
  method: 'post',
  path: '/{id}/retries',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    201: jsonContent(backgroundJobSchema, 'Retried background job'),
    404: errorResponse('Not found'),
    409: errorResponse('Background job cannot be retried'),
  },
})

const app = new OpenAPIHono<Env>()
app.use(requireAuth)

const backgroundJobs = app
  .openapi(listRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return apiError(c, 404, 'No organization found')
    const query = c.req.valid('query')
    const result = await listBackgroundJobs(c.get('deps'), orgId, query)
    return c.json({ ...result, page: query.page, pageSize: query.pageSize }, 200)
  })
  .openapi(createJobRoute, async (c) => {
    const orgId = requireOrg(c)
    const userId = c.get('userId')
    if (!userId) throw new BackgroundJobError('not_found')
    return c.json(await createBackgroundJob(c.get('deps'), { orgId, userId, request: c.req.valid('json') }), 201)
  })
  .openapi(getJobRoute, async (c) =>
    c.json(await getBackgroundJob(c.get('deps'), requireOrg(c), c.req.valid('param').id), 200),
  )
  .openapi(cancelJobRoute, async (c) =>
    c.json(await cancelBackgroundJob(c.get('deps'), requireOrg(c), c.req.valid('param').id), 200),
  )
  .openapi(retryJobRoute, async (c) =>
    c.json(await retryBackgroundJob(c.get('deps'), requireOrg(c), c.req.valid('param').id), 201),
  )

export default backgroundJobs
