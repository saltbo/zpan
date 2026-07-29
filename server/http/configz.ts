import { OpenAPIHono } from '@hono/zod-openapi'
import { siteConfigSchema } from '@shared/schemas'
import { currentCacheEvents } from '../cache/context'
import type { Env } from '../middleware/platform'
import { siteConfigCacheControl } from '../usecases/site/config-cache'
import { getSiteConfig } from '../usecases/site/configz'
import { authRoute, jsonContent } from './openapi'

const getRoute = authRoute(
  { access: 'public' },
  {
    operationId: 'getSiteConfig',
    summary: 'Get public site configuration',
    tags: ['Site Config'],
    method: 'get',
    path: '/',
    responses: {
      200: jsonContent(siteConfigSchema, 'Public site configuration'),
      304: { description: 'Not modified' },
    },
  },
)

const encoder = new TextEncoder()

async function responseEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(body))
  return `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}"`
}

export const configz = new OpenAPIHono<Env>().openapi(getRoute, async (c) => {
  const config = await getSiteConfig(c.get('deps'), c.req.url)
  const body = JSON.stringify(config)
  const etag = await responseEtag(body)
  const cacheControl = siteConfigCacheControl(c.get('deps'))
  const headers = { 'Cache-Control': cacheControl, ETag: etag }
  const cacheTier =
    [...currentCacheEvents()].reverse().find((event) => event.namespace === 'site-config')?.tier ?? 'source'
  const responseHeaders = { ...headers, 'X-ZPan-Cache': cacheTier }
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304, responseHeaders)
  return c.json(config, 200, responseHeaders)
})
