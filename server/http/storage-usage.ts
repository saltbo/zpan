import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { STORAGE_USAGE_CATEGORIES } from '@shared/storage-usage'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { notFound } from '../usecases/ports'
import { getStorageUsage } from '../usecases/storage-usage-dashboard'
import { jsonContent } from './openapi'

const categorySchema = z.enum(STORAGE_USAGE_CATEGORIES)
const breakdownSchema = z.object({
  category: categorySchema,
  bytes: z.number().int(),
  fileCount: z.number().int(),
})
const usageSchema = z
  .object({
    usedBytes: z.number().int(),
    quotaBytes: z.number().int(),
    currentPlan: z.object({ name: z.string(), storageBytes: z.number().int(), subscription: z.boolean() }).nullable(),
    breakdowns: z.array(breakdownSchema),
    updatedAt: z.string().nullable(),
  })
  .openapi('StorageUsage')

const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().int(),
  updatedAt: z.string(),
  source: z.enum(['files', 'image_hosting', 'trash']),
})

const getUsageRoute = createRoute({
  operationId: 'getStorageUsage',
  summary: 'Get current storage usage by category',
  tags: ['Storage Usage'],
  method: 'get',
  path: '/',
  responses: { 200: jsonContent(usageSchema, 'Storage usage') },
})

const listItemsRoute = createRoute({
  operationId: 'listStorageUsageItems',
  summary: 'List files in a storage usage category',
  tags: ['Storage Usage'],
  method: 'get',
  path: '/items',
  request: {
    query: z.object({
      category: categorySchema,
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        items: z.array(itemSchema),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
      }),
      'Storage usage items',
    ),
  },
})

function requireOrg(c: { get(key: 'orgId'): string | null }) {
  const orgId = c.get('orgId')
  if (!orgId) throw notFound('No organization found')
  return orgId
}

const app = new OpenAPIHono<Env>()
app.use(requireAuth)

const storageUsage = app
  .openapi(getUsageRoute, async (c) => c.json(await getStorageUsage(c.get('deps'), requireOrg(c)), 200))
  .openapi(listItemsRoute, async (c) => {
    const query = c.req.valid('query')
    const result = await c
      .get('deps')
      .storageUsageBreakdowns.listItems(requireOrg(c), query.category, query.page, query.pageSize)
    return c.json({ ...result, page: query.page, pageSize: query.pageSize }, 200)
  })

export default storageUsage
