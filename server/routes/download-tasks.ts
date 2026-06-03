import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { createDownloadTaskSchema, listDownloadTasksQuerySchema, updateDownloadTaskSchema } from '@shared/schemas'
import type { Context } from 'hono'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  createDownloadTask,
  DownloadError,
  getDownloadTask,
  listDownloadTasks,
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
  status: z.enum(['queued', 'assigned', 'running', 'billing_paused', 'uploading', 'completed', 'failed', 'canceled']),
  downloadedBytes: int64Schema(),
  totalBytes: nullableInt64Schema(),
  downloadBps: int64Schema(),
  uploadBps: int64Schema(),
  resultObjectId: z.string().nullable().optional(),
  uploadToken: z.string().optional(),
  assignedDownloaderId: z.string().nullable().optional(),
})

const downloadTaskPageSchema = z.object({
  items: z.array(downloadTaskSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})

function jsonResponse(schema: z.ZodType, description: string) {
  return { content: { 'application/json': { schema } }, description }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: listDownloadTasksQuerySchema },
  responses: {
    200: jsonResponse(downloadTaskPageSchema, 'Download tasks'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
  },
})

const createRouteDoc = createRoute({
  method: 'post',
  path: '/',
  middleware: [requireAuth, requireTeamRole('editor')] as const,
  request: { body: { content: { 'application/json': { schema: createDownloadTaskSchema } }, required: true } },
  responses: {
    201: jsonResponse(downloadTaskSchema, 'Created download task'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
    402: jsonResponse(errorSchema, 'Insufficient credits'),
    409: jsonResponse(errorSchema, 'Download task conflict'),
  },
})

const getRoute = createRoute({
  method: 'get',
  path: '/{id}',
  middleware: [requireAuth] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonResponse(downloadTaskSchema, 'Download task'),
    404: jsonResponse(errorSchema, 'Not found'),
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
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

const downloadTasksRoute = new OpenAPIHono<Env>()
  .openapi(listRoute, (async (c: OpenAPIContext) => {
    const principal = c.get('principal')
    const query = c.req.valid('query') as z.infer<typeof listDownloadTasksQuerySchema>
    if (query.assignedTo === 'me') {
      if (principal?.kind !== 'downloader') return c.json({ error: 'Unauthorized' }, 401)
      const result = await listDownloadTasks(c.get('platform'), {
        downloaderId: principal.downloaderId,
        status: query.status,
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
      page: query.page,
      pageSize: query.pageSize,
    })
    return c.json({ ...result, page: query.page, pageSize: query.pageSize })
  }) as never)
  .openapi(createRouteDoc, (async (c: OpenAPIContext) => {
    const orgId = c.get('orgId')
    const userId = c.get('userId')
    if (!orgId || !userId) return c.json({ error: 'Unauthorized' }, 401)
    return downloadTaskResponse(
      c,
      async () =>
        createDownloadTask(
          c.get('platform'),
          orgId,
          userId,
          c.req.valid('json') as z.infer<typeof createDownloadTaskSchema>,
        ),
      201,
    )
  }) as never)
  .openapi(getRoute, (async (c: OpenAPIContext) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'Unauthorized' }, 401)
    const id = c.req.param('id') as string
    return downloadTaskResponse(c, async () => getDownloadTask(c.get('platform'), orgId, id))
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
