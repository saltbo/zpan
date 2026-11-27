import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { cursorPageQuerySchema, cursorPageSchema, opaqueIdSchema } from '@shared/schemas'
import { STORAGE_USAGE_CATEGORIES, STORAGE_USAGE_SORT_FIELDS } from '@shared/storage-usage'
import type { Env } from '../middleware/platform'
import { notFound } from '../usecases/ports'
import { getStorageUsage, listStorageUsageItems } from '../usecases/storage-usage-dashboard'
import { authRoute, errorResponse, jsonContent } from './openapi'
import { decodeOptionalPageToken, encodeNextPageToken, pageQueryFingerprint, sortValueCursorCodec } from './page-token'

const categorySchema = z.enum(STORAGE_USAGE_CATEGORIES)
const sortFieldSchema = z.enum(STORAGE_USAGE_SORT_FIELDS)
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

const itemSchema = z
  .object({
    id: opaqueIdSchema,
    name: z.string(),
    path: z.string(),
    parentPath: z.string(),
    type: z.string(),
    size: z.number().int(),
    updatedAt: z.string(),
    source: z.enum(['files', 'image_hosting', 'trash']),
  })
  .openapi('StorageUsageItem')

const getUsageRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGE_USAGE_READ], minTeamRole: 'viewer' },
  {
    operationId: 'getStorageUsage',
    summary: 'Get current storage usage by category',
    tags: ['Storage Usage'],
    method: 'get',
    path: '/',
    responses: { 200: jsonContent(usageSchema, 'Storage usage') },
  },
)

const listItemsRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGE_USAGE_READ], minTeamRole: 'viewer' },
  {
    operationId: 'listStorageUsageItems',
    summary: 'List files in a storage usage category',
    tags: ['Storage Usage'],
    method: 'get',
    path: '/items',
    request: {
      query: cursorPageQuerySchema.extend({
        category: categorySchema,
        sortBy: sortFieldSchema.default('size'),
        sortDir: z.enum(['asc', 'desc']).default('desc'),
      }),
    },
    responses: {
      200: jsonContent(cursorPageSchema(itemSchema, 'StorageUsageItemPage'), 'Storage usage items'),
      400: errorResponse('Invalid page token'),
    },
  },
)

function requireOrg(c: { get(key: 'orgId'): string | null }) {
  const orgId = c.get('orgId')
  if (!orgId) throw notFound('No organization found')
  return orgId
}

const app = new OpenAPIHono<Env>()

const storageUsage = app
  .openapi(getUsageRoute, async (c) => c.json(await getStorageUsage(c.get('deps'), requireOrg(c)), 200))
  .openapi(listItemsRoute, async (c) => {
    const { pageToken, ...query } = c.req.valid('query')
    const orgId = requireOrg(c)
    const page = {
      query: await pageQueryFingerprint({ resource: 'storage-usage-items', orgId, ...query }),
      codec: sortValueCursorCodec,
    }
    const after = await decodeOptionalPageToken(c.get('platform'), pageToken, page)
    const result = await listStorageUsageItems(c.get('deps'), orgId, { ...query, after })
    return c.json(
      { items: result.items, nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, page) },
      200,
    )
  })

export default storageUsage
