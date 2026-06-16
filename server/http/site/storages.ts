import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { createStorageSchema, featureGateErrorSchema, updateStorageSchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import type { StorageRecord } from '../../usecases/ports'
import {
  createStorage,
  deleteStorage,
  getStorage,
  listStorages,
  type StorageFeatureBlock,
  updateStorage,
} from '../../usecases/site/storage'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

// Admin storage config. The response intentionally includes the S3 credentials
// (accessKey/secretKey) so the admin UI can pre-fill the edit form — admin-only.
// Timestamps are the only Date fields; toStorageDTO serializes them.
const storageSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    mode: z.string(),
    bucket: z.string(),
    endpoint: z.string(),
    region: z.string(),
    accessKey: z.string(),
    secretKey: z.string(),
    filePath: z.string(),
    customHost: z.string().nullable(),
    capacity: z.number().int(),
    egressCreditBillingEnabled: z.boolean(),
    egressCreditUnitBytes: z.number().int(),
    egressCreditPerUnit: z.number().int(),
    used: z.number().int(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Storage')

type StorageDTO = z.infer<typeof storageSchema>

function toStorageDTO(s: StorageRecord): StorageDTO {
  return { ...s, createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString() }
}

const storageListSchema = z.object({ items: z.array(storageSchema), total: z.number().int() }).openapi('StorageList')

const featureNotAvailable = (block: StorageFeatureBlock) => ({ error: 'feature_not_available', ...block })

const listRoute = createRoute({
  operationId: 'listStorages',
  summary: 'List storages',
  tags: ['Storages'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(storageListSchema, 'Storages') },
})

const createStorageRoute = createRoute({
  operationId: 'createStorage',
  summary: 'Create storage',
  tags: ['Storages'],
  method: 'post',
  path: '/',
  middleware: [requireAdmin] as const,
  request: jsonBody(createStorageSchema),
  responses: {
    201: jsonContent(storageSchema, 'Created storage'),
    402: jsonContent(featureGateErrorSchema, 'Feature not available'),
  },
})

const getStorageRoute = createRoute({
  operationId: 'getStorage',
  summary: 'Get storage',
  tags: ['Storages'],
  method: 'get',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(storageSchema, 'Storage'),
    404: errorResponse('Storage not found'),
  },
})

const updateStorageRoute = createRoute({
  operationId: 'updateStorage',
  summary: 'Update storage',
  tags: ['Storages'],
  method: 'put',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }), ...jsonBody(updateStorageSchema) },
  responses: {
    200: jsonContent(storageSchema, 'Updated storage'),
    402: jsonContent(featureGateErrorSchema, 'Feature not available'),
    404: errorResponse('Storage not found'),
  },
})

const deleteStorageRoute = createRoute({
  operationId: 'deleteStorage',
  summary: 'Delete storage',
  tags: ['Storages'],
  method: 'delete',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(z.object({ id: z.string(), deleted: z.literal(true) }), 'Deleted storage'),
    404: errorResponse('Storage not found'),
    409: errorResponse('Storage is referenced by existing files'),
  },
})

const storages = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const result = await listStorages(c.get('deps'))
    return c.json({ items: result.items.map(toStorageDTO), total: result.total }, 200)
  })
  .openapi(createStorageRoute, async (c) => {
    const result = await createStorage(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      input: c.req.valid('json'),
    })
    if (!result.ok) return c.json(featureNotAvailable(result.block), 402)
    return c.json(toStorageDTO(result.storage), 201)
  })
  .openapi(getStorageRoute, async (c) => {
    const storage = await getStorage(c.get('deps'), c.req.valid('param').id)
    if (!storage) return c.json({ error: 'Storage not found' }, 404)
    return c.json(toStorageDTO(storage), 200)
  })
  .openapi(updateStorageRoute, async (c) => {
    const result = await updateStorage(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      id: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (result.ok) return c.json(toStorageDTO(result.storage), 200)
    if (result.reason === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    return c.json(featureNotAvailable(result.block), 402)
  })
  .openapi(deleteStorageRoute, async (c) => {
    const id = c.req.valid('param').id
    const result = await deleteStorage(c.get('deps'), { userId: c.get('userId')!, orgId: c.get('orgId')!, id })
    if (result.ok) return c.json({ id, deleted: true as const }, 200)
    if (result.reason === 'not_found') return c.json({ error: 'Storage not found' }, 404)
    return c.json({ error: 'Storage is referenced by existing files' }, 409)
  })

export default storages
