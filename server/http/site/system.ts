import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageSchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { runtimeInfo } from '../../usecases/site/instance-info'
import {
  deleteSystemOption,
  getChangelog,
  getSystemOption,
  listSystemOptions,
  resolveInstanceInfo,
  setSystemOption,
} from '../../usecases/site/system'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

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

const systemOptionSchema = z.object({ key: z.string(), value: z.string(), public: z.boolean() }).openapi('SystemOption')

const systemOptionListSchema = pageSchema(systemOptionSchema, 'SystemOptionList')

const setOptionSchema = z.object({ value: z.string(), public: z.boolean().optional() })

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

const listOptionsRoute = createRoute({
  operationId: 'listSystemOptions',
  summary: 'List system options',
  tags: ['System'],
  method: 'get',
  path: '/options',
  responses: { 200: jsonContent(systemOptionListSchema, 'System options') },
})

const getOptionRoute = createRoute({
  operationId: 'getSystemOption',
  summary: 'Get a system option',
  tags: ['System'],
  method: 'get',
  path: '/options/{key}',
  request: { params: z.object({ key: z.string() }) },
  responses: {
    200: jsonContent(systemOptionSchema, 'System option'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Option not found'),
  },
})

const setOptionRoute = createRoute({
  operationId: 'setSystemOption',
  summary: 'Set a system option',
  tags: ['System'],
  method: 'put',
  path: '/options/{key}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ key: z.string() }), ...jsonBody(setOptionSchema) },
  responses: {
    200: jsonContent(systemOptionSchema, 'Updated option'),
    201: jsonContent(systemOptionSchema, 'Created option'),
    400: errorResponse('Invalid option'),
    402: errorResponse('Feature not available'),
  },
})

const deleteOptionRoute = createRoute({
  operationId: 'deleteSystemOption',
  summary: 'Delete a system option',
  tags: ['System'],
  method: 'delete',
  path: '/options/{key}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: jsonContent(z.object({ key: z.string(), deleted: z.literal(true) }), 'Deleted option') },
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
  .openapi(listOptionsRoute, async (c) => {
    const { items } = await listSystemOptions(c.get('deps'), { isAdmin: c.get('userRole') === 'admin' })
    return c.json({ items, total: items.length, page: 1, pageSize: items.length }, 200)
  })
  .openapi(getOptionRoute, async (c) => {
    const result = await getSystemOption(c.get('deps'), {
      key: c.req.valid('param').key,
      isAdmin: c.get('userRole') === 'admin',
    })
    if (!result.ok) throw result.error
    return c.json(result.option, 200)
  })
  .openapi(setOptionRoute, async (c) => {
    const body = c.req.valid('json')
    const result = await setSystemOption(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      key: c.req.valid('param').key,
      value: body.value,
      public: body.public,
    })
    if (!result.ok) throw result.error
    return result.created ? c.json(result.option, 201) : c.json(result.option, 200)
  })
  .openapi(deleteOptionRoute, async (c) =>
    c.json(
      await deleteSystemOption(c.get('deps'), {
        userId: c.get('userId')!,
        orgId: c.get('orgId')!,
        key: c.req.valid('param').key,
      }),
      200,
    ),
  )

export default system
