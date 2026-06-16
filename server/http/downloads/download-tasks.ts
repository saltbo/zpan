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
import { errorResponse, jsonBody, jsonContent } from '../openapi'

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
    200: jsonContent(z.object({ id: z.string(), deleted: z.literal(true) }), 'Deleted download task'),
    ...taskErrorResponses,
  },
})

const downloadTasksRoute = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const principal = c.get('principal')
    const query = c.req.valid('query')
    if (query.assignedTo === 'me') {
      if (principal?.kind !== 'downloader') return c.json({ error: 'Unauthorized' }, 401)
      const result = await listDownloadTasks(c.get('deps'), c.get('platform'), {
        downloaderId: principal.downloaderId,
        status: query.status,
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
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const result = await listDownloadTasks(c.get('deps'), c.get('platform'), {
      orgId,
      status: query.status,
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
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const actorId = principal?.kind === 'api-key' ? `api-key:${principal.keyId}` : (c.get('userId') as string)
    return c.json(await createDownloadTask(c.get('deps'), orgId, actorId, c.req.valid('json')), 201)
  })
  .openapi(getRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(await getDownloadTask(c.get('deps'), orgId, c.req.valid('param').id), 200)
  })
  .openapi(statusRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const { status } = c.req.valid('json')
    const action = status === 'paused' ? 'pause' : status === 'queued' ? 'resume' : 'cancel'
    return c.json(await performDownloadTaskAction(c.get('deps'), orgId, c.req.valid('param').id, action), 200)
  })
  .openapi(attemptRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const { fresh } = c.req.valid('json')
    return c.json(
      await performDownloadTaskAction(c.get('deps'), orgId, c.req.valid('param').id, fresh ? 'restart' : 'retry'),
      201,
    )
  })
  .openapi(deleteRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(await performDownloadTaskAction(c.get('deps'), orgId, c.req.valid('param').id, 'delete'), 200)
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
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    return c.json(await updateDownloadTask(c.get('deps'), c.get('platform'), id, input, { orgId }), 200)
  })

export default downloadTasksRoute
