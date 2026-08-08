import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  createBackgroundJobRequestSchema,
  cursorPageSchema,
  listBackgroundJobsQuerySchema,
  opaqueIdSchema,
} from '../../shared/schemas'
import { authzActorIdentity, type Env } from '../middleware/platform'
import {
  cancelBackgroundJob,
  createBackgroundJob,
  getActiveBackgroundJobCount,
  getBackgroundJob,
  listBackgroundJobs,
  retryBackgroundJob,
} from '../usecases/background-job'
import { BackgroundJobError, notFound } from '../usecases/ports'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from './page-token'

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
    id: opaqueIdSchema,
    orgId: opaqueIdSchema,
    userId: opaqueIdSchema,
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

const backgroundJobPageSchema = cursorPageSchema(backgroundJobSchema, 'BackgroundJobPage')

// The only client-driven status transition is cancellation.
const cancelJobSchema = z.object({ status: z.literal('canceled') })

// A missing org/job throws BackgroundJobError('not_found'); a bad transition throws
// not_cancelable/not_retryable. The global onError maps them to 404 / 409.
function requireOrg(c: { get(key: 'orgId'): string | null }): string {
  const orgId = c.get('orgId')
  if (!orgId) throw new BackgroundJobError('not_found')
  return orgId
}

const listRoute = authRoute(
  { scopes: [AuthorizationScope.BACKGROUND_JOBS_READ] },
  {
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
  },
)

const createJobRoute = authRoute(
  { scopes: [AuthorizationScope.BACKGROUND_JOBS_CREATE] },
  {
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
  },
)

const statsRoute = authRoute(
  { scopes: [AuthorizationScope.BACKGROUND_JOBS_READ] },
  {
    operationId: 'getBackgroundJobStats',
    summary: 'Get active background job count',
    tags: ['Background Jobs'],
    method: 'get',
    path: '/stats',
    responses: {
      200: jsonContent(z.object({ activeCount: z.number().int() }), 'Background job stats'),
      404: errorResponse('No organization found'),
    },
  },
)

const getJobRoute = authRoute(
  { scopes: [AuthorizationScope.BACKGROUND_JOBS_READ] },
  {
    operationId: 'getBackgroundJob',
    summary: 'Get background job',
    tags: ['Background Jobs'],
    method: 'get',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(backgroundJobSchema, 'Background job'),
      404: errorResponse('Not found'),
    },
  },
)

const cancelJobRoute = authRoute(
  { scopes: [AuthorizationScope.BACKGROUND_JOBS_UPDATE] },
  {
    operationId: 'cancelBackgroundJob',
    summary: 'Cancel background job',
    tags: ['Background Jobs'],
    method: 'put',
    path: '/{id}/status',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(cancelJobSchema) },
    responses: {
      200: jsonContent(backgroundJobSchema, 'Canceled background job'),
      404: errorResponse('Not found'),
      409: errorResponse('Background job cannot be canceled'),
    },
  },
)

const retryJobRoute = authRoute(
  { scopes: [AuthorizationScope.BACKGROUND_JOBS_UPDATE] },
  {
    operationId: 'retryBackgroundJob',
    summary: 'Retry background job',
    tags: ['Background Jobs'],
    method: 'post',
    path: '/{id}/retries',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      201: jsonContent(backgroundJobSchema, 'Retried background job'),
      404: errorResponse('Not found'),
      409: errorResponse('Background job cannot be retried'),
    },
  },
)

const app = new OpenAPIHono<Env>()

const backgroundJobs = app
  .openapi(listRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw notFound('No organization found')
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({
      orgId,
      status: query.status ?? null,
      type: query.type ?? null,
      pageSize: query.pageSize,
    })
    const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, {
      query: fingerprint,
      codec: createdAtIdCursorCodec,
    })
    const result = await listBackgroundJobs(c.get('deps'), orgId, { ...query, after })
    return c.json(
      {
        items: result.items,
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, {
          query: fingerprint,
          codec: createdAtIdCursorCodec,
        }),
      },
      200,
    )
  })
  .openapi(statsRoute, async (c) => {
    const activeCount = await getActiveBackgroundJobCount(c.get('deps'), requireOrg(c))
    return c.json({ activeCount }, 200)
  })
  .openapi(createJobRoute, async (c) => {
    const orgId = requireOrg(c)
    const userId = c.get('userId')
    if (!userId) throw new BackgroundJobError('not_found')
    const createdBy = authzActorIdentity(c.get('authzContext'))
    if (!createdBy) throw new Error('authenticated_actor_missing')
    return c.json(
      await createBackgroundJob(c.get('deps'), { orgId, userId, createdBy, request: c.req.valid('json') }),
      201,
    )
  })
  .openapi(getJobRoute, async (c) =>
    c.json(await getBackgroundJob(c.get('deps'), requireOrg(c), c.req.valid('param').id), 200),
  )
  .openapi(cancelJobRoute, async (c) =>
    c.json(await cancelBackgroundJob(c.get('deps'), requireOrg(c), c.req.valid('param').id), 200),
  )
  .openapi(retryJobRoute, async (c) => {
    const createdBy = authzActorIdentity(c.get('authzContext'))
    if (!createdBy) throw new Error('authenticated_actor_missing')
    return c.json(await retryBackgroundJob(c.get('deps'), requireOrg(c), c.req.valid('param').id, createdBy), 201)
  })

export default backgroundJobs
