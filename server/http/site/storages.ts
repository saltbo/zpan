import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import {
  createStorageSchema,
  pageSchema,
  patchStorageSchema,
  replaceStorageSchema,
  updateStorageEgressBillingSchema,
} from '@shared/schemas'
import { opaqueIdSchema } from '@shared/schemas/identifiers'
import type { Env } from '../../middleware/platform'
import { type StorageRecord, storageNotFound } from '../../usecases/ports'
import {
  createStorage,
  deleteStorage,
  getStorage,
  listStorages,
  patchStorage,
  replaceStorage,
  updateStorageEgressBilling,
} from '../../usecases/site/storage'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'

// Admin storage config. The response intentionally includes the S3 credentials
// (accessKey/secretKey) so the admin UI can pre-fill the edit form — admin-only.
// Timestamps are the only Date fields; toStorageDTO serializes them.
const storageSchema = z
  .object({
    id: opaqueIdSchema,
    provider: z.string(),
    bucket: z.string(),
    endpoint: z.string(),
    region: z.string(),
    accessKey: z.string(),
    secretKey: z.string(),
    filePath: z.string(),
    capacity: z.number().int(),
    egressCreditBillingEnabled: z.boolean(),
    egressCreditUnitBytes: z.number().int(),
    egressCreditPerUnit: z.number().int(),
    forcePathStyle: z.boolean(),
    used: z.number().int(),
    enabled: z.boolean(),
    status: z.enum(['unknown', 'healthy', 'unhealthy']),
    statusReason: z
      .enum(['cors', 'authentication_failed', 'permission_denied', 'bucket_not_found', 'network_error', 'unknown'])
      .nullable(),
    statusCheckedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Storage')

type StorageDTO = z.infer<typeof storageSchema>

function toStorageDTO(s: StorageRecord): StorageDTO {
  return {
    ...s,
    statusCheckedAt: s.statusCheckedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  }
}

const storageListSchema = pageSchema(storageSchema, 'StorageList')

const listRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_READ], siteRole: 'admin' },
  {
    operationId: 'listStorages',
    summary: 'List storages',
    tags: ['Storages'],
    method: 'get',
    path: '/',
    responses: { 200: jsonContent(storageListSchema, 'Storages') },
  },
)

const createStorageRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_CREATE], siteRole: 'admin' },
  {
    operationId: 'createStorage',
    summary: 'Create storage',
    tags: ['Storages'],
    method: 'post',
    path: '/',
    request: jsonBody(createStorageSchema),
    responses: {
      201: jsonContent(storageSchema, 'Created storage'),
      402: errorResponse('Feature not available'),
    },
  },
)

const getStorageRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_READ], siteRole: 'admin' },
  {
    operationId: 'getStorage',
    summary: 'Get storage',
    tags: ['Storages'],
    method: 'get',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(storageSchema, 'Storage'),
      404: errorResponse('Storage not found'),
    },
  },
)

const replaceStorageRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_UPDATE], siteRole: 'admin' },
  {
    operationId: 'replaceStorage',
    summary: 'Replace storage',
    tags: ['Storages'],
    method: 'put',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(replaceStorageSchema) },
    responses: {
      200: jsonContent(storageSchema, 'Replaced storage'),
      402: errorResponse('Feature not available'),
      404: errorResponse('Storage not found'),
    },
  },
)

const patchStorageRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_UPDATE], siteRole: 'admin' },
  {
    operationId: 'patchStorage',
    summary: 'Patch storage',
    tags: ['Storages'],
    method: 'patch',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(patchStorageSchema) },
    responses: {
      200: jsonContent(storageSchema, 'Updated storage'),
      402: errorResponse('Feature not available'),
      404: errorResponse('Storage not found'),
    },
  },
)

const updateStorageEgressBillingRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_UPDATE], siteRole: 'admin' },
  {
    operationId: 'updateStorageEgressBilling',
    summary: 'Update storage egress billing',
    tags: ['Storages'],
    method: 'put',
    path: '/{id}/egress-billing',
    request: { params: z.object({ id: opaqueIdSchema }), ...jsonBody(updateStorageEgressBillingSchema) },
    responses: {
      200: jsonContent(storageSchema, 'Updated storage'),
      402: errorResponse('Feature not available'),
      404: errorResponse('Storage not found'),
    },
  },
)

const deleteStorageRoute = authRoute(
  { scopes: [AuthorizationScope.STORAGES_DELETE], siteRole: 'admin' },
  {
    operationId: 'deleteStorage',
    summary: 'Delete storage',
    tags: ['Storages'],
    method: 'delete',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Deleted storage' },
      404: errorResponse('Storage not found'),
      409: errorResponse('Storage is referenced by existing files'),
    },
  },
)

const storages = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const result = await listStorages(c.get('deps'))
    const items = result.items.map(toStorageDTO)
    return c.json({ items, total: items.length, page: 1, pageSize: items.length }, 200)
  })
  .openapi(createStorageRoute, async (c) => {
    const result = await createStorage(c.get('deps'), {
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(toStorageDTO(result.storage), 201)
  })
  .openapi(getStorageRoute, async (c) => {
    const storage = await getStorage(c.get('deps'), c.req.valid('param').id)
    if (!storage) throw storageNotFound()
    return c.json(toStorageDTO(storage), 200)
  })
  .openapi(replaceStorageRoute, async (c) => {
    const result = await replaceStorage(c.get('deps'), {
      id: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(toStorageDTO(result.storage), 200)
  })
  .openapi(patchStorageRoute, async (c) => {
    const result = await patchStorage(c.get('deps'), {
      id: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(toStorageDTO(result.storage), 200)
  })
  .openapi(updateStorageEgressBillingRoute, async (c) => {
    const result = await updateStorageEgressBilling(c.get('deps'), {
      id: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(toStorageDTO(result.storage), 200)
  })
  .openapi(deleteStorageRoute, async (c) => {
    const id = c.req.valid('param').id
    const result = await deleteStorage(c.get('deps'), { id })
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })

export default storages
