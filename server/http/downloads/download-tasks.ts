import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  createDownloadTaskSchema,
  downloadTaskAttemptSchema,
  downloadTaskPageSchema,
  downloadTaskSchema,
  downloadTaskStatusUpdateSchema,
  listDownloadTasksQuerySchema,
  updateDownloadTaskSchema,
} from '@shared/schemas'
import { requirePermission } from '../../middleware/authz'
import type { Env } from '../../middleware/platform'
import {
  createDownloadTask,
  getDownloadTask,
  listDownloadTasks,
  performDownloadTaskAction,
  updateDownloadTask,
} from '../../usecases/downloads/downloads'
import { badRequest, unauthorized } from '../../usecases/ports'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

const downloadTaskStatuses = new Set([
  'queued',
  'assigned',
  'downloading',
  'suspended',
  'pausing',
  'paused',
  'interrupted',
  'uploading',
  'canceling',
  'completed',
  'failed',
  'canceled',
])

function parseStatuses(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const requested = value
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean)
  if (requested.length === 0) return undefined
  const invalid = requested.filter((status) => !downloadTaskStatuses.has(status))
  if (invalid.length > 0) throw badRequest('Invalid task status', 'INVALID_STATUS')
  return requested
}

// Every task operation surfaces the same DownloadError-based failure model. The
// usecases throw it; the global onError converts it (not_found→404, forbidden→403,
// invalid_state→409). These entries only document those outcomes — 401 comes from
// the explicit org/principal guards in the handlers.
const taskErrorResponses = {
  401: errorResponse('Unauthorized'),
  403: errorResponse('Forbidden'),
  404: errorResponse('Not found'),
  409: errorResponse('Invalid task state'),
}

const listRoute = createRoute({
  operationId: 'listDownloadTasks',
  summary: 'List download tasks',
  tags: ['Download Tasks'],
  method: 'get',
  path: '/',
  middleware: [requirePermission('remoteDownload', 'read', { allowDownloader: true })] as const,
  request: { query: listDownloadTasksQuerySchema },
  responses: {
    200: jsonContent(downloadTaskPageSchema, 'Download tasks'),
    400: errorResponse('Invalid query'),
    401: errorResponse('Unauthorized'),
  },
})

const createRouteDoc = createRoute({
  operationId: 'createDownloadTask',
  summary: 'Create download task',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/',
  middleware: [requirePermission('remoteDownload', 'create', { minTeamRole: 'editor' })] as const,
  request: jsonBody(createDownloadTaskSchema),
  responses: {
    201: jsonContent(downloadTaskSchema, 'Created download task'),
    ...taskErrorResponses,
  },
})

const getRoute = createRoute({
  operationId: 'getDownloadTask',
  summary: 'Get download task',
  tags: ['Download Tasks'],
  method: 'get',
  path: '/{id}',
  middleware: [requirePermission('remoteDownload', 'read')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(downloadTaskSchema, 'Download task'),
    ...taskErrorResponses,
  },
})

const updateRoute = createRoute({
  operationId: 'updateDownloadTask',
  summary: 'Update download task',
  tags: ['Download Tasks'],
  method: 'patch',
  path: '/{id}',
  middleware: [requirePermission('remoteDownload', 'cancel', { allowDownloader: true })] as const,
  request: { params: z.object({ id: z.string() }), ...jsonBody(updateDownloadTaskSchema) },
  responses: {
    200: jsonContent(downloadTaskSchema, 'Updated download task'),
    ...taskErrorResponses,
  },
})

const statusRoute = createRoute({
  operationId: 'setDownloadTaskStatus',
  summary: 'Pause, resume, or cancel a task',
  tags: ['Download Tasks'],
  method: 'put',
  path: '/{id}/status',
  middleware: [requirePermission('remoteDownload', 'cancel')] as const,
  request: { params: z.object({ id: z.string() }), ...jsonBody(downloadTaskStatusUpdateSchema) },
  responses: {
    200: jsonContent(downloadTaskSchema, 'Updated download task'),
    ...taskErrorResponses,
  },
})

const attemptRoute = createRoute({
  operationId: 'retryDownloadTask',
  summary: 'Retry or restart a task',
  tags: ['Download Tasks'],
  method: 'post',
  path: '/{id}/attempts',
  middleware: [requirePermission('remoteDownload', 'cancel')] as const,
  request: { params: z.object({ id: z.string() }), ...jsonBody(downloadTaskAttemptSchema) },
  responses: {
    201: jsonContent(downloadTaskSchema, 'New download attempt'),
    ...taskErrorResponses,
  },
})

const deleteRoute = createRoute({
  operationId: 'deleteDownloadTask',
  summary: 'Delete download task',
  tags: ['Download Tasks'],
  method: 'delete',
  path: '/{id}',
  middleware: [requirePermission('remoteDownload', 'cancel')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    204: { description: 'Deleted download task' },
    ...taskErrorResponses,
  },
})

const downloadTasksRoute = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const principal = c.get('principal')
    const query = c.req.valid('query')
    const statuses = parseStatuses(query.status)
    if (query.assignedTo === 'me') {
      if (principal?.kind !== 'downloader') throw unauthorized()
      const result = await listDownloadTasks(c.get('deps'), c.get('platform'), {
        downloaderId: principal.downloaderId,
        status: statuses?.length === 1 ? statuses[0] : undefined,
        statuses,
        category: query.category,
        tag: query.tag,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        page: query.page,
        pageSize: query.pageSize,
        includeUploadToken: true,
      })
      return c.json({ ...result, page: query.page, pageSize: query.pageSize }, 200)
    }

    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const result = await listDownloadTasks(c.get('deps'), c.get('platform'), {
      orgId,
      status: statuses?.length === 1 ? statuses[0] : undefined,
      statuses,
      category: query.category,
      tag: query.tag,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      pageSize: query.pageSize,
    })
    return c.json({ ...result, page: query.page, pageSize: query.pageSize }, 200)
  })
  .openapi(createRouteDoc, async (c) => {
    const principal = c.get('principal')
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const actorId = principal?.kind === 'api-key' ? `api-key:${principal.keyId}` : (c.get('userId') as string)
    return c.json(await createDownloadTask(c.get('deps'), orgId, actorId, c.req.valid('json')), 201)
  })
  .openapi(getRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    return c.json(await getDownloadTask(c.get('deps'), orgId, c.req.valid('param').id), 200)
  })
  .openapi(statusRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const { status } = c.req.valid('json')
    const action = status === 'paused' ? 'pause' : status === 'queued' ? 'resume' : 'cancel'
    return c.json(await performDownloadTaskAction(c.get('deps'), orgId, c.req.valid('param').id, action), 200)
  })
  .openapi(attemptRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const { fresh } = c.req.valid('json')
    return c.json(
      await performDownloadTaskAction(c.get('deps'), orgId, c.req.valid('param').id, fresh ? 'restart' : 'retry'),
      201,
    )
  })
  .openapi(deleteRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    await performDownloadTaskAction(c.get('deps'), orgId, c.req.valid('param').id, 'delete')
    return c.body(null, 204)
  })
  .openapi(updateRoute, async (c) => {
    const principal = c.get('principal')
    const id = c.req.valid('param').id
    const input = c.req.valid('json')
    if (principal?.kind === 'downloader') {
      return c.json(
        await updateDownloadTask(c.get('deps'), c.get('platform'), id, input, { downloaderId: principal.downloaderId }),
        200,
      )
    }
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    return c.json(await updateDownloadTask(c.get('deps'), c.get('platform'), id, input, { orgId }), 200)
  })

export default downloadTasksRoute
