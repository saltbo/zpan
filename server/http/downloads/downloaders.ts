import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  createDownloaderResponseSchema,
  createDownloaderSchema,
  downloaderHeartbeatResultSchema,
  downloaderHeartbeatSchema,
  downloaderSchema,
  opaqueIdSchema,
  pageSchema,
  updateDownloaderCreditBillingSchema,
  updateDownloaderSchema,
} from '@shared/schemas'
import { FREE_DOWNLOADER_LIMIT } from '../../../shared/constants'
import { hasFeature } from '../../domain/licensing'
import type { Env } from '../../middleware/platform'
import {
  createDownloader,
  createDownloaderWithBootstrapCredential,
  deleteDownloader,
  listDownloaders,
  recordDownloaderHeartbeat,
  updateDownloader,
  updateDownloaderCreditBilling,
} from '../../usecases/downloads/downloads'
import { featureBlocked, unauthorized } from '../../usecases/ports'
import { loadBindingState } from '../../usecases/site/licensing'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

const downloaderListSchema = pageSchema(downloaderSchema, 'DownloaderList')

const listRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOADERS_READ], siteRole: 'admin' },
  {
    operationId: 'listDownloaders',
    summary: 'List downloaders',
    tags: ['Downloaders'],
    method: 'get',
    path: '/',
    responses: {
      200: jsonContent(downloaderListSchema, 'Downloaders'),
      401: errorResponse('Unauthorized'),
    },
  },
)

const createRouteDoc = authRoute(
  {
    scopes: [AuthorizationScope.DOWNLOADERS_CREATE],
    siteRole: 'admin',
  },
  {
    operationId: 'createDownloader',
    summary: 'Register downloader',
    tags: ['Downloaders'],
    method: 'post',
    path: '/',
    request: jsonBody(createDownloaderSchema),
    responses: {
      201: jsonContent(createDownloaderResponseSchema, 'Downloader registration'),
      401: errorResponse('Unauthorized'),
      402: errorResponse('Feature not available'),
    },
  },
)

const updateRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOADERS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateDownloader',
    summary: 'Update downloader',
    tags: ['Downloaders'],
    method: 'patch',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(updateDownloaderSchema) },
    responses: {
      200: jsonContent(downloaderSchema, 'Updated downloader'),
      402: errorResponse('Feature not available'),
      404: errorResponse('Not found'),
    },
  },
)

const updateCreditBillingRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOADERS_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateDownloaderCreditBilling',
    summary: 'Update downloader credit billing',
    tags: ['Downloaders'],
    method: 'put',
    path: '/{id}/credit-billing',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(updateDownloaderCreditBillingSchema) },
    responses: {
      200: jsonContent(downloaderSchema, 'Updated downloader'),
      402: errorResponse('Feature not available'),
      404: errorResponse('Not found'),
    },
  },
)

const deleteRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOADERS_DELETE], siteRole: 'admin' },
  {
    operationId: 'deleteDownloader',
    summary: 'Delete downloader',
    tags: ['Downloaders'],
    method: 'delete',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Deleted downloader' },
      404: errorResponse('Not found'),
    },
  },
)

const heartbeatRoute = authRoute(
  { scopes: [AuthorizationScope.DOWNLOADERS_UPDATE] },
  {
    operationId: 'recordDownloaderHeartbeat',
    summary: 'Send downloader heartbeat',
    tags: ['Downloaders'],
    method: 'post',
    path: '/me/heartbeats',
    request: jsonBody(downloaderHeartbeatSchema),
    responses: {
      200: jsonContent(downloaderHeartbeatResultSchema, 'Updated downloader and task commands'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Not found'),
    },
  },
)

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
    const principal = c.get('principal')
    const input = c.req.valid('json')
    const result =
      principal?.kind === 'downloader-bootstrap'
        ? await createDownloaderWithBootstrapCredential(deps, c.get('platform'), input, userId, principal.sessionToken)
        : await createDownloader(deps, c.get('platform'), input, userId)
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
  .openapi(updateCreditBillingRoute, async (c) => {
    const { id } = c.req.valid('param')
    return c.json(await updateDownloaderCreditBilling(c.get('deps'), id, c.req.valid('json')), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const { id } = c.req.valid('param')
    await deleteDownloader(c.get('deps'), id)
    return c.body(null, 204)
  })

export const downloaderSelfRoute = new OpenAPIHono<Env>().openapi(heartbeatRoute, async (c) => {
  const principal = c.get('principal')
  if (principal?.kind !== 'downloader') throw unauthorized()
  return c.json(
    await recordDownloaderHeartbeat(c.get('deps'), c.get('platform'), principal.downloaderId, c.req.valid('json')),
    200,
  )
})

export default downloadersRoute
