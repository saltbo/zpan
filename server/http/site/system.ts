import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { runtimeInfo } from '../../usecases/site/instance-info'
import { getChangelog, resolveInstanceInfo } from '../../usecases/site/system'
import { jsonContent } from '../openapi'

const instanceInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    version: z.string(),
    commit: z.string().nullable().optional(),
    runtime: z.string().nullable().optional(),
    platform: z.string().nullable().optional(),
    server: z
      .object({
        os: z
          .object({
            platform: z.string().nullable().optional(),
            arch: z.string().nullable().optional(),
            release: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    node: z.object({ version: z.string().nullable().optional() }).nullable().optional(),
  })
  .openapi('InstanceInfo')

const changelogSchema = z
  .object({
    currentVersion: z.string(),
    latestVersion: z.string().nullable(),
    updateAvailable: z.boolean(),
    markdown: z.string(),
  })
  .openapi('Changelog')

const instanceRoute = createRoute({
  operationId: 'getInstanceInfo',
  summary: 'Get instance info',
  tags: ['System'],
  method: 'get',
  path: '/instance',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(instanceInfoSchema, 'Instance info') },
})

const changelogRoute = createRoute({
  operationId: 'getChangelog',
  summary: 'Get changelog',
  tags: ['System'],
  method: 'get',
  path: '/changelog',
  middleware: [requireAdmin] as const,
  request: { query: z.object({ refresh: z.string().optional() }) },
  responses: { 200: jsonContent(changelogSchema, 'Changelog') },
})

const system = new OpenAPIHono<Env>()
  .openapi(instanceRoute, async (c) => {
    const info = await resolveInstanceInfo(c.get('deps'), {
      requestUrl: c.req.url,
      runtime: runtimeInfo(c.get('platform')),
    })
    return c.json(info, 200)
  })
  .openapi(changelogRoute, async (c) =>
    c.json(await getChangelog(c.get('deps'), { now: Date.now(), force: c.req.valid('query').refresh === 'true' }), 200),
  )

export default system
