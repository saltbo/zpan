import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  createDownloaderResponseSchema,
  createDownloaderSchema,
  deleteDownloaderResponseSchema,
  downloaderHeartbeatSchema,
  downloaderSchema,
  pageSchema,
  updateDownloaderSchema,
} from '@shared/schemas'
import { FREE_DOWNLOADER_LIMIT } from '../../../shared/constants'
import { hasFeature } from '../../domain/licensing'
import { requireAdmin, requireDownloader } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import {
  createDownloader,
  deleteDownloader,
  listDownloaders,
  recordDownloaderHeartbeat,
  updateDownloader,
} from '../../usecases/downloads/downloads'
import { featureBlocked, unauthorized } from '../../usecases/ports'
import { loadBindingState } from '../../usecases/site/licensing'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

const downloaderListSchema = pageSchema(downloaderSchema, 'DownloaderList')

const listRoute = createRoute({
  operationId: 'listDownloaders',
  summary: 'List downloaders',
  tags: ['Downloaders'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: {
    200: jsonContent(downloaderListSchema, 'Downloaders'),
    401: errorResponse('Unauthorized'),
  },
})

const createRouteDoc = createRoute({
  operationId: 'createDownloader',
  summary: 'Register downloader',
  tags: ['Downloaders'],
  method: 'post',
  path: '/',
  middleware: [requireAdmin] as const,
  request: jsonBody(createDownloaderSchema),
  responses: {
    201: jsonContent(createDownloaderResponseSchema, 'Downloader registration'),
    401: errorResponse('Unauthorized'),
    402: errorResponse('Feature not available'),
  },
})

const updateRoute = createRoute({
  operationId: 'updateDownloader',
  summary: 'Update downloader',
  tags: ['Downloaders'],
  method: 'patch',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }), ...jsonBody(updateDownloaderSchema) },
  responses: {
    200: jsonContent(downloaderSchema, 'Updated downloader'),
    402: errorResponse('Feature not available'),
    404: errorResponse('Not found'),
  },
})

const deleteRoute = createRoute({
  operationId: 'deleteDownloader',
  summary: 'Delete downloader',
  tags: ['Downloaders'],
  method: 'delete',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(deleteDownloaderResponseSchema, 'Deleted downloader'),
    404: errorResponse('Not found'),
  },
})

const heartbeatRoute = createRoute({
  operationId: 'recordDownloaderHeartbeat',
  summary: 'Send downloader heartbeat',
  tags: ['Downloaders'],
  method: 'post',
  path: '/me/heartbeats',
  middleware: [requireDownloader] as const,
  request: jsonBody(downloaderHeartbeatSchema),
  responses: {
    200: jsonContent(downloaderSchema, 'Updated downloader'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('Not found'),
  },
})

// A missing downloader makes the usecase throw DownloadError('not_found'); the
// global onError maps it to 404, so these handlers carry no error plumbing.
const downloadersRoute = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const items = await listDownloaders(c.get('deps'))
    return c.json({ items, total: items.length, page: 1, pageSize: items.length }, 200)
  })
  .openapi(createRouteDoc, async (c) => {
    const userId = c.get('userId')
    if (!userId) throw unauthorized()
    const deps = c.get('deps')
    const [existing, state] = await Promise.all([listDownloaders(deps), loadBindingState(deps)])
    if (!hasFeature('downloaders_unlimited', state) && existing.length >= FREE_DOWNLOADER_LIMIT) {
      throw featureBlocked('Feature not available', {
        metadata: {
          feature: 'downloaders_unlimited',
          currentCount: String(existing.length),
          limit: String(FREE_DOWNLOADER_LIMIT),
          upgradeUrl: '/settings/billing',
        },
      })
    }
    const result = await createDownloader(deps, c.get('platform'), c.req.valid('json'), userId)
    return c.json(result, 201)
  })
  .openapi(updateRoute, async (c) => {
    const { id } = c.req.valid('param')
    const input = c.req.valid('json')
    if (input.remoteDownloadCreditBillingEnabled === true) {
      const state = await loadBindingState(c.get('deps'))
      if (!hasFeature('quota_store', state)) {
        throw featureBlocked('Feature not available', {
          metadata: { feature: 'quota_store' },
        })
      }
    }
    return c.json(await updateDownloader(c.get('deps'), id, input), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid('param')
    return c.json(await deleteDownloader(c.get('deps'), id), 200)
  })

export const downloaderSelfRoute = new OpenAPIHono<Env>().openapi(heartbeatRoute, async (c) => {
  const principal = c.get('principal')
  if (principal?.kind !== 'downloader') throw unauthorized()
  return c.json(await recordDownloaderHeartbeat(c.get('deps'), principal.downloaderId, c.req.valid('json')), 200)
})

export default downloadersRoute
