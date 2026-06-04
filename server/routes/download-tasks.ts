import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  createDownloadTaskSchema,
  downloadTaskActionInputSchema,
  downloadTaskDetailSchema,
  listDownloadTasksQuerySchema,
  updateDownloadTaskSchema,
} from '@shared/schemas'
import type { Context } from 'hono'
import { requirePermission } from '../middleware/authz'
import type { Env } from '../middleware/platform'
import {
  createDownloadTask,
  DownloadError,
  getDownloadTask,
  listDownloadTasks,
  performDownloadTaskAction,
  updateDownloadTask,
} from '../services/downloads'

const errorSchema = z.object({ error: z.string() })
const int64Schema = () => z.number().int().openapi({ type: 'integer', format: 'int64' })
const nullableInt64Schema = () =>
  z
    .number()
    .int()
    .nullable()
    .openapi({ type: 'integer', format: 'int64', nullable: true } as never)

type OpenAPIContext = Context<Env> & {
  req: Context<Env>['req'] & {
    valid(target: 'json' | 'query'): unknown
    param(name: string): string
  }
}

const downloadTaskSchema = z.object({
  id: z.string(),
  sourceType: z.enum(['http', 'magnet', 'torrent_url']),
  sourceUri: z.string(),
  name: z.string(),
  targetFolder: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  status: z.enum([
    'queued',
    'assigned',
    'running',
    'billing_paused',
    'paused',
    'uploading',
    'completed',
    'failed',
    'canceled',
  ]),
  downloadedBytes: int64Schema(),
  storageUploadedBytes: int64Schema(),
  totalBytes: nullableInt64Schema(),
  downloadBps: int64Schema(),
  storageUploadBps: int64Schema(),
  errorMessage: z.string().nullable().optional(),
  resultObjectId: z.string().nullable().optional(),
  detail: downloadTaskDetailSchema.nullable().optional(),
  uploadToken: z.string().optional(),
  assignedDownloaderId: z.string().nullable().optional(),
})

const downloadTaskPageSchema = z.object({
  items: z.array(downloadTaskSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

const sseEncoder = new TextEncoder()
const downloadTaskEventIntervalMs = 2000

function jsonResponse(schema: z.ZodType, description: string) {
  return { content: { 'application/json': { schema } }, description }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [requirePermission('remoteDownload', 'read', { allowDownloader: true })] as const,
  request: { query: listDownloadTasksQuerySchema },
  responses: {
    200: jsonResponse(downloadTaskPageSchema, 'Download tasks'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
  },
})

const createRouteDoc = createRoute({
  method: 'post',
  path: '/',
  middleware: [requirePermission('remoteDownload', 'create', { minTeamRole: 'editor' })] as const,
  request: { body: { content: { 'application/json': { schema: createDownloadTaskSchema } }, required: true } },
  responses: {
    201: jsonResponse(downloadTaskSchema, 'Created download task'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
    402: jsonResponse(errorSchema, 'Insufficient credits'),
    409: jsonResponse(errorSchema, 'Download task conflict'),
  },
})

const eventsRoute = createRoute({
  method: 'get',
  path: '/events',
  middleware: [requirePermission('remoteDownload', 'read')] as const,
  request: { query: listDownloadTasksQuerySchema },
  responses: {
    200: {
      content: { 'text/event-stream': { schema: z.string() } },
      description: 'Download task events',
    },
    401: jsonResponse(errorSchema, 'Unauthorized'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  middleware: [requirePermission('remoteDownload', 'read')] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonResponse(downloadTaskSchema, 'Download task'),
    404: jsonResponse(errorSchema, 'Not found'),
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  middleware: [requirePermission('remoteDownload', 'cancel', { allowDownloader: true })] as const,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateDownloadTaskSchema } }, required: true },
  },
  responses: {
    200: jsonResponse(downloadTaskSchema, 'Updated download task'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
    402: jsonResponse(errorSchema, 'Insufficient credits'),
    404: jsonResponse(errorSchema, 'Not found'),
    409: jsonResponse(errorSchema, 'Download task conflict'),
  },
})

const actionRoute = createRoute({
  method: 'post',
  path: '/{id}/actions',
  middleware: [requirePermission('remoteDownload', 'cancel')] as const,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: downloadTaskActionInputSchema } }, required: true },
  },
  responses: {
    200: jsonResponse(
      z.union([downloadTaskSchema, z.object({ id: z.string(), deleted: z.literal(true) })]),
      'Task action result',
    ),
    401: jsonResponse(errorSchema, 'Unauthorized'),
    403: jsonResponse(errorSchema, 'Forbidden'),
    404: jsonResponse(errorSchema, 'Not found'),
    409: jsonResponse(errorSchema, 'Invalid task state'),
  },
})

const downloadTasksRoute = new OpenAPIHono<Env>()
  .openapi(listRoute, (async (c: OpenAPIContext) => {
    const principal = c.get('principal')
    const query = c.req.valid('query') as z.infer<typeof listDownloadTasksQuerySchema>
    if (query.assignedTo === 'me') {
      if (principal?.kind !== 'downloader') return c.json({ error: 'Unauthorized' }, 401)
      const result = await listDownloadTasks(c.get('platform'), {
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
      return c.json({ ...result, page: query.page, pageSize: query.pageSize })
    }

    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const result = await listDownloadTasks(c.get('platform'), {
      orgId,
      status: query.status,
      category: query.category,
      tag: query.tag,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      page: query.page,
      pageSize: query.pageSize,
    })
    return c.json({ ...result, page: query.page, pageSize: query.pageSize })
  }) as never)
  .openapi(createRouteDoc, (async (c: OpenAPIContext) => {
    const principal = c.get('principal')
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const actorId = principal?.kind === 'api-key' ? `api-key:${principal.keyId}` : (c.get('userId') as string)
    return downloadTaskResponse(
      c,
      async () =>
        createDownloadTask(
          c.get('platform'),
          orgId,
          actorId,
          c.req.valid('json') as z.infer<typeof createDownloadTaskSchema>,
        ),
      201,
    )
  }) as never)
  .openapi(eventsRoute, (async (c: OpenAPIContext) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const query = c.req.valid('query') as z.infer<typeof listDownloadTasksQuerySchema>
    const signal = c.req.raw.signal
    let closed = false
    let lastFingerprint = ''

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        }
        const tick = async () => {
          if (closed) return
          try {
            const result = await listDownloadTasks(c.get('platform'), {
              orgId,
              status: query.status,
              category: query.category,
              tag: query.tag,
              sortBy: query.sortBy,
              sortDir: query.sortDir,
              page: query.page,
              pageSize: query.pageSize,
            })
            const fingerprint = result.items.map((task) => `${task.id}:${task.updatedAt}`).join('|')
            if (fingerprint !== lastFingerprint) {
              lastFingerprint = fingerprint
              send('snapshot', { items: result.items, total: result.total, page: query.page, pageSize: query.pageSize })
            } else {
              send('heartbeat', { at: new Date().toISOString() })
            }
          } catch (error) {
            send('error', { message: error instanceof Error ? error.message : 'unknown error' })
          }
          if (!closed) setTimeout(tick, downloadTaskEventIntervalMs)
        }
        signal.addEventListener('abort', () => {
          closed = true
          controller.close()
        })
        void tick()
      },
      cancel() {
        closed = true
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  }) as never)
  .openapi(getRoute, (async (c: OpenAPIContext) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const id = c.req.param('id') as string
    return downloadTaskResponse(c, async () => getDownloadTask(c.get('platform'), orgId, id))
  }) as never)
  .openapi(actionRoute, (async (c: OpenAPIContext) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const id = c.req.param('id') as string
    const { action } = c.req.valid('json') as z.infer<typeof downloadTaskActionInputSchema>
    return downloadTaskResponse(c, async () => performDownloadTaskAction(c.get('platform'), orgId, id, action))
  }) as never)
  .openapi(updateRoute, (async (c: OpenAPIContext) => {
    const principal = c.get('principal')
    const id = c.req.param('id') as string
    if (principal?.kind === 'downloader') {
      return downloadTaskResponse(
        c,
        async () =>
          updateDownloadTask(c.get('platform'), id, c.req.valid('json') as z.infer<typeof updateDownloadTaskSchema>, {
            downloaderId: principal.downloaderId,
          }),
        undefined,
      )
    }
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    return downloadTaskResponse(c, async () =>
      updateDownloadTask(c.get('platform'), id, c.req.valid('json') as z.infer<typeof updateDownloadTaskSchema>, {
        orgId,
      }),
    )
  }) as never)

export default downloadTasksRoute

async function downloadTaskResponse(c: Context<Env>, action: () => Promise<unknown>, status: 200 | 201 = 200) {
  try {
    return c.json(await action(), status)
  } catch (error) {
    if (error instanceof DownloadError) {
      if (error.code === 'not_found') return c.json({ error: 'Not found' }, 404)
      if (error.code === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
      if (error.code === 'billing_paused') return c.json({ error: 'insufficient_credits' }, 402)
      return c.json({ error: error.message }, 409)
    }
    throw error
  }
}
