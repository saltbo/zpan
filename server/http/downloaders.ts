import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  createDownloaderResponseSchema,
  createDownloaderSchema,
  deleteDownloaderResponseSchema,
  downloaderHeartbeatSchema,
  downloaderListSchema,
  downloaderSchema,
  updateDownloaderSchema,
} from '@shared/schemas'
import type { Context } from 'hono'
import { FREE_DOWNLOADER_LIMIT } from '../../shared/constants'
import { hasFeature, loadBindingState } from '../licensing/has-feature'
import { requireAdmin, requireDownloader } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  createDownloader,
  DownloadError,
  deleteDownloader,
  listDownloaders,
  recordDownloaderHeartbeat,
  updateDownloader,
} from '../services/downloads'

const errorSchema = z.object({ error: z.string() })

type OpenAPIContext = Context<Env> & {
  req: Context<Env>['req'] & {
    valid(target: 'json'): unknown
    param(name: string): string
  }
}

function jsonResponse(schema: z.ZodType, description: string) {
  return { content: { 'application/json': { schema } }, description }
}

const listRoute = createRoute({
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonResponse(downloaderListSchema, 'Downloaders'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
  },
})

const createRouteDoc = createRoute({
  method: 'post',
  path: '/',
  middleware: [requireAdmin] as const,
  request: { body: { content: { 'application/json': { schema: createDownloaderSchema } }, required: true } },
  responses: {
    201: jsonResponse(createDownloaderResponseSchema, 'Downloader registration'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
    402: jsonResponse(errorSchema, 'Feature not available'),
  },
})

const updateRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: {
    params: z.object({ id: z.string() }),
    body: { content: { 'application/json': { schema: updateDownloaderSchema } }, required: true },
  },
  responses: {
    200: jsonResponse(downloaderSchema, 'Updated downloader'),
    404: jsonResponse(errorSchema, 'Not found'),
  },
})

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonResponse(deleteDownloaderResponseSchema, 'Deleted downloader'),
    404: jsonResponse(errorSchema, 'Not found'),
  },
})

const heartbeatRoute = createRoute({
  method: 'post',
  path: '/heartbeat',
  middleware: [requireDownloader] as const,
  request: { body: { content: { 'application/json': { schema: downloaderHeartbeatSchema } }, required: true } },
  responses: {
    200: jsonResponse(downloaderSchema, 'Updated downloader'),
    401: jsonResponse(errorSchema, 'Unauthorized'),
  },
})

const downloadersRoute = new OpenAPIHono<Env>()
  .openapi(listRoute, (async (c: OpenAPIContext) => {
    const items = await listDownloaders(c.get('platform'))
    return c.json({ items, total: items.length })
  }) as never)
  .openapi(createRouteDoc, (async (c: OpenAPIContext) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: 'Unauthorized' }, 401)
    const platform = c.get('platform')
    const [existing, state] = await Promise.all([listDownloaders(platform), loadBindingState(platform.db)])
    if (!hasFeature('downloaders_unlimited', state) && existing.length >= FREE_DOWNLOADER_LIMIT) {
      return c.json(
        {
          error: 'feature_not_available',
          feature: 'downloaders_unlimited',
          currentCount: existing.length,
          limit: FREE_DOWNLOADER_LIMIT,
          upgrade_url: '/settings/billing',
        },
        402,
      )
    }
    const result = await createDownloader(
      platform,
      c.req.valid('json') as z.infer<typeof createDownloaderSchema>,
      userId,
    )
    return c.json(result, 201)
  }) as never)
  .openapi(updateRoute, (async (c: OpenAPIContext) => {
    const id = c.req.param('id') as string
    const input = c.req.valid('json') as z.infer<typeof updateDownloaderSchema>
    if (input.remoteDownloadCreditBillingEnabled === true) {
      const state = await loadBindingState(c.get('platform').db)
      if (!hasFeature('quota_store', state)) {
        return c.json({ error: 'feature_not_available', feature: 'quota_store' }, 402)
      }
    }
    return downloadResponse(c, async () => updateDownloader(c.get('platform'), id, input))
  }) as never)
  .openapi(deleteRoute, (async (c: OpenAPIContext) => {
    const id = c.req.param('id') as string
    return downloadResponse(c, async () => deleteDownloader(c.get('platform'), id))
  }) as never)

export const downloaderSelfRoute = new OpenAPIHono<Env>().openapi(heartbeatRoute, (async (c: OpenAPIContext) => {
  const principal = c.get('principal')
  if (principal?.kind !== 'downloader') return c.json({ error: 'Unauthorized' }, 401)
  return downloadResponse(c, async () =>
    recordDownloaderHeartbeat(
      c.get('platform'),
      principal.downloaderId,
      c.req.valid('json') as z.infer<typeof downloaderHeartbeatSchema>,
    ),
  )
}) as never)

export default downloadersRoute

async function downloadResponse(c: Context<Env>, action: () => Promise<unknown>) {
  try {
    return c.json(await action())
  } catch (error) {
    if (error instanceof DownloadError && error.code === 'not_found') return c.json({ error: 'Not found' }, 404)
    throw error
  }
}
