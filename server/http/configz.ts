import { createRoute, OpenAPIHono } from '@hono/zod-openapi'
import { siteConfigSchema } from '@shared/schemas'
import type { Env } from '../middleware/platform'
import { getSiteConfig } from '../usecases/site/configz'
import { jsonContent } from './openapi'

const getRoute = createRoute({
  operationId: 'getSiteConfig',
  summary: 'Get public site configuration',
  tags: ['Site Config'],
  method: 'get',
  path: '/',
  responses: { 200: jsonContent(siteConfigSchema, 'Public site configuration') },
})

export const configz = new OpenAPIHono<Env>().openapi(getRoute, async (c) =>
  c.json(await getSiteConfig(c.get('deps'), c.req.url), 200),
)
