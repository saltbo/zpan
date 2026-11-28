import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  createDownloadTaskSchema,
  downloadTaskAttemptSchema,
  downloadTaskListPageSchema,
  downloadTaskPageSchema,
  downloadTaskSchema,
  downloadTaskStatusUpdateSchema,
  downloadTaskTimelineSchema,
  listDownloadTasksQuerySchema,
  opaqueIdSchema,
  torrentStreamChunkSchema,
  torrentStreamStateSchema,
  updateDownloadTaskSchema,
} from '@shared/schemas'
import type { Env } from '../../middleware/platform'
import {
  createDownloadTask,
  getDownloadTask,
  getDownloadTaskTimeline,
  listDownloadTaskItems,
  listDownloadTasks,
  performDownloadTaskAction,
  updateDownloadTask,
} from '../../usecases/downloads/downloads'
import { badRequest, unauthorized } from '../../usecases/ports'
import { getTaskStreamState, putTaskStreamChunk } from '../../usecases/torrents/stream'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from '../page-token'
import { createRouter } from '../router'

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

async function resolvePage(
  c: {
    get(name: 'deps'): Env['Variables']['deps']
    get(name: 'platform'): Env['Variables']['platform']
  },
  filters: Omit<import('../../usecases/ports').ListDownloadTasksFilters, 'after'> & {
    includeUploadToken?: boolean
  },
  pageToken?: string,
) {
  const query = await pageQueryFingerprint({
    orgId: filters.orgId ?? null,
    downloaderId: filters.downloaderId ?? null,
    statuses: filters.statuses ?? null,
    category: filters.category ?? null,
    tag: filters.tag ?? null,
    pageSize: filters.pageSize,
  })
  const after = await decodeOptionalPageToken(c.get('platform'), pageToken, {
    query,
    codec: createdAtIdCursorCodec,
  })
  return { filters: { ...filters, after }, query }
}

async function pageTokenFor(
  c: { get(name: 'platform'): Env['Variables']['platform'] },
  nextBoundary: { createdAt: Date; id: string } | null,
  query: string,
) {
  return encodeNextPageToken(c.get('platform'), nextBoundary, {
    query,
    codec: createdAtIdCursorCodec,
  })
}

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

const listRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ] },
  {
    operationId: 'listDownloadTasks',
    summary: 'List download tasks',
    tags: ['Download Tasks'],
    method: 'get',
    path: '/',
    request: { query: listDownloadTasksQuerySchema },
    responses: {
      200: jsonContent(downloadTaskListPageSchema, 'Download task list'),
      400: errorResponse('Invalid query'),
      401: errorResponse('Unauthorized'),
    },
  },
)

const downloaderTaskListRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ] },
  {
    operationId: 'listDownloaderTasks',
    summary: 'List tasks owned by the authenticated downloader',
    tags: ['Downloaders'],
    method: 'get',
    path: '/me/tasks',
    request: { query: listDownloadTasksQuerySchema },
    responses: {
      200: jsonContent(downloadTaskPageSchema, 'Assigned download tasks'),
      400: errorResponse('Invalid query'),
      401: errorResponse('Unauthorized'),
    },
  },
)

const createRouteDoc = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CREATE], minTeamRole: 'editor' },
  {
    operationId: 'createDownloadTask',
    summary: 'Create download task',
    tags: ['Download Tasks'],
    method: 'post',
    path: '/',
    request: jsonBody(createDownloadTaskSchema),
    responses: {
      201: jsonContent(downloadTaskSchema, 'Created download task'),
      ...taskErrorResponses,
    },
  },
)

const getRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ] },
  {
    operationId: 'getDownloadTask',
    summary: 'Get download task',
    tags: ['Download Tasks'],
    method: 'get',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(downloadTaskSchema, 'Download task'),
      ...taskErrorResponses,
    },
  },
)

const eventsRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_READ] },
  {
    operationId: 'listDownloadTaskEvents',
    summary: 'List download task timeline events',
    tags: ['Download Tasks'],
    method: 'get',
    path: '/{id}/events',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(downloadTaskTimelineSchema, 'Download task timeline'),
      ...taskErrorResponses,
    },
  },
)

const updateRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CANCEL], credential: 'downloader' },
  {
    operationId: 'updateDownloadTask',
    summary: 'Report download task progress',
    tags: ['Download Tasks'],
    method: 'patch',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(updateDownloadTaskSchema) },
    responses: {
      200: jsonContent(downloadTaskSchema, 'Updated download task'),
      ...taskErrorResponses,
    },
  },
)

const statusRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CANCEL], minTeamRole: 'editor' },
  {
    operationId: 'setDownloadTaskStatus',
    summary: 'Pause, resume, or cancel a task',
    tags: ['Download Tasks'],
    method: 'put',
    path: '/{id}/status',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(downloadTaskStatusUpdateSchema) },
    responses: {
      200: jsonContent(downloadTaskSchema, 'Updated download task'),
      ...taskErrorResponses,
    },
  },
)

const attemptRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CANCEL], minTeamRole: 'editor' },
  {
    operationId: 'retryDownloadTask',
    summary: 'Retry or restart a task',
    tags: ['Download Tasks'],
    method: 'post',
    path: '/{id}/attempts',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(downloadTaskAttemptSchema) },
    responses: {
      201: jsonContent(downloadTaskSchema, 'New download attempt'),
      ...taskErrorResponses,
    },
  },
)

const deleteRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CANCEL], minTeamRole: 'editor' },
  {
    operationId: 'deleteDownloadTask',
    summary: 'Delete download task',
    tags: ['Download Tasks'],
    method: 'delete',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Deleted download task' },
      ...taskErrorResponses,
    },
  },
)

const streamStateRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CANCEL], credential: 'downloader' },
  {
    operationId: 'getDownloadTaskTorrentStream',
    summary: 'Get what to upload for streaming a torrent',
    description:
      'For a task that fills a downloading torrent: the pieces players want and the chunks already stored, so the downloader uploads whole pieces from each wanted piece on (docs/design/torrents.md §14). 409 when the task does not fill a downloading torrent.',
    tags: ['Download Tasks'],
    method: 'get',
    path: '/{id}/torrent-stream',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(torrentStreamStateSchema, 'Stream state'),
      ...taskErrorResponses,
    },
  },
)

const streamChunkRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOAD_TASKS_CANCEL], credential: 'downloader' },
  {
    operationId: 'putDownloadTaskTorrentStreamChunk',
    summary: 'Upload whole pieces for streaming a torrent',
    description:
      "The torrent's concatenated bytes from the first byte of `firstPiece` to the end of a later piece. Every piece is checked against the info dictionary before the chunk is stored; a piece that does not match answers 400.",
    tags: ['Download Tasks'],
    method: 'put',
    path: '/{id}/torrent-stream/chunks/{firstPiece}',
    request: {
      params: z.object({ id: opaqueIdSchema, firstPiece: z.coerce.number().int().nonnegative() }),
      body: {
        required: true,
        content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } },
      },
    },
    responses: {
      201: jsonContent(torrentStreamChunkSchema, 'Stored chunk'),
      400: errorResponse('A piece does not match, or the chunk does not end on a piece'),
      ...taskErrorResponses,
    },
  },
)

const downloadTasksRoute = createRouter()
  .openapi(listRoute, async (c) => {
    const query = c.req.valid('query')
    const statuses = parseStatuses(query.status)
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    const page = await resolvePage(
      c,
      {
        orgId,
        status: statuses?.length === 1 ? statuses[0] : undefined,
        statuses,
        category: query.category,
        tag: query.tag,
        pageSize: query.pageSize,
      },
      query.pageToken,
    )
    const result = await listDownloadTaskItems(c.get('deps'), page.filters)
    return c.json(
      {
        items: result.items,
        nextPageToken: await pageTokenFor(c, result.nextBoundary, page.query),
      },
      200,
    )
  })
  .openapi(createRouteDoc, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    // API keys carry their owning user's UID in userId, so downloader uploads
    // build the same org/uid object path as browser-created tasks.
    const actor = c.get('authzContext').actor
    if (!actor) throw unauthorized()
    return c.json(
      await createDownloadTask(c.get('deps'), orgId, c.get('userId') as string, c.req.valid('json'), {
        type: actor.type,
        ref: actor.ref,
        issuer: 'issuer' in actor ? actor.issuer : null,
      }),
      201,
    )
  })
  .openapi(getRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    return c.json(await getDownloadTask(c.get('deps'), orgId, c.req.valid('param').id), 200)
  })
  .openapi(eventsRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw unauthorized()
    return c.json(await getDownloadTaskTimeline(c.get('deps'), orgId, c.req.valid('param').id), 200)
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
  .openapi(streamStateRoute, async (c) => {
    const principal = c.get('principal')
    if (principal?.kind !== 'downloader') throw unauthorized()
    const taskId = c.req.valid('param').id
    return c.json(await getTaskStreamState(c.get('deps'), { taskId, downloaderId: principal.downloaderId }), 200)
  })
  .openapi(streamChunkRoute, async (c) => {
    const principal = c.get('principal')
    if (principal?.kind !== 'downloader') throw unauthorized()
    const { id: taskId, firstPiece } = c.req.valid('param')
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    return c.json(
      await putTaskStreamChunk(c.get('deps'), { taskId, downloaderId: principal.downloaderId, firstPiece, bytes }),
      201,
    )
  })
  .openapi(updateRoute, async (c) => {
    const principal = c.get('principal')
    const id = c.req.valid('param').id
    const input = c.req.valid('json')
    if (principal?.kind !== 'downloader') throw new Error('authorized_downloader_principal_missing')
    return c.json(
      await updateDownloadTask(c.get('deps'), c.get('platform'), id, input, { downloaderId: principal.downloaderId }),
      200,
    )
  })

export const downloaderTasksRoute = createRouter().openapi(downloaderTaskListRoute, async (c) => {
  const principal = c.get('principal')
  if (principal?.kind !== 'downloader') throw unauthorized()
  const query = c.req.valid('query')
  const statuses = parseStatuses(query.status)
  const page = await resolvePage(
    c,
    {
      downloaderId: principal.downloaderId,
      status: statuses?.length === 1 ? statuses[0] : undefined,
      statuses,
      category: query.category,
      tag: query.tag,
      pageSize: query.pageSize,
      includeUploadToken: true,
    },
    query.pageToken,
  )
  const result = await listDownloadTasks(c.get('deps'), c.get('platform'), page.filters)
  return c.json(
    {
      items: result.items,
      nextPageToken: await pageTokenFor(c, result.nextBoundary, page.query),
    },
    200,
  )
})

export default downloadTasksRoute
