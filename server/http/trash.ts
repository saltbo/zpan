import { OpenAPIHono, z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { cursorPageQuerySchema, cursorPageSchema, restoreObjectSchema } from '@shared/schemas'
import { opaqueIdSchema, opaqueTokenSchema } from '@shared/schemas/identifiers'
import type { Env } from '../middleware/platform'
import { deleteObject, getTrashObject, listTrashedObjects, restoreObject } from '../usecases/object'
import { badRequest, type Matter, notFound } from '../usecases/ports'
import { authRoute, errorResponse, jsonBody, jsonContent } from './openapi'
import { decodeOptionalPageToken, encodeNextPageToken, pageQueryFingerprint, trashCursorCodec } from './page-token'

// The trashed-object wire shape mirrors the live Matter model; trash is a
// grouping/view of `objects`, not a separate resource.
const matterSchema = z
  .object({
    id: opaqueIdSchema,
    orgId: opaqueIdSchema,
    alias: opaqueTokenSchema,
    name: z.string(),
    type: z.string(),
    size: z.number().int().nullable(),
    dirtype: z.number().int().nullable(),
    parent: z.string(),
    object: z.string(),
    storageId: opaqueIdSchema,
    status: z.string(),
    trashedAt: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TrashObject')

type MatterDTO = z.infer<typeof matterSchema>

function toMatterDTO(m: Matter): MatterDTO {
  return {
    id: m.id,
    orgId: m.orgId,
    alias: m.alias,
    name: m.name,
    type: m.type,
    size: m.size,
    dirtype: m.dirtype,
    parent: m.parent,
    object: m.object,
    storageId: m.storageId,
    status: m.status,
    trashedAt: m.trashedAt,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }
}

const trashPageSchema = cursorPageSchema(matterSchema, 'TrashObjectPage')
const idParam = z.object({ id: opaqueIdSchema })

const listTrashRoute = authRoute(
  { scopes: [AuthorizationScope.OBJECTS_READ], minTeamRole: 'viewer' },
  {
    operationId: 'listTrashObjects',
    summary: 'List trashed objects',
    tags: ['Trash'],
    method: 'get',
    path: '/objects',
    request: { query: cursorPageQuerySchema },
    responses: {
      200: jsonContent(trashPageSchema, 'Trashed objects (roots only)'),
      400: errorResponse('No active organization'),
    },
  },
)

const getTrashObjectRoute = authRoute(
  { scopes: [AuthorizationScope.OBJECTS_READ], minTeamRole: 'viewer' },
  {
    operationId: 'getTrashObject',
    summary: 'Get trashed object',
    tags: ['Trash'],
    method: 'get',
    path: '/objects/{id}',
    request: { params: idParam },
    responses: {
      200: jsonContent(matterSchema, 'Trashed object'),
      400: errorResponse('No active organization'),
      404: errorResponse('Not found'),
    },
  },
)

const restoreObjectRoute = authRoute(
  { scopes: [AuthorizationScope.OBJECTS_UPDATE], minTeamRole: 'editor' },
  {
    operationId: 'restoreObject',
    summary: 'Restore trashed object',
    tags: ['Trash'],
    method: 'post',
    path: '/objects/{id}/restorations',
    request: { params: idParam, ...jsonBody(restoreObjectSchema) },
    responses: {
      200: jsonContent(matterSchema, 'Restored object'),
      400: errorResponse('No active organization'),
      404: errorResponse('Not found'),
      409: errorResponse('Name conflict'),
    },
  },
)

const purgeObjectRoute = authRoute(
  { scopes: [AuthorizationScope.OBJECTS_PURGE], minTeamRole: 'editor' },
  {
    operationId: 'purgeTrashObject',
    summary: 'Permanently delete trashed object',
    tags: ['Trash'],
    method: 'delete',
    path: '/objects/{id}',
    request: { params: idParam },
    responses: {
      204: { description: 'Permanently removed (recursive subtree purge)' },
      400: errorResponse('No active organization'),
      404: errorResponse('Not found'),
    },
  },
)

const app = new OpenAPIHono<Env>()

const trash = app
  .openapi(listTrashRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({ orgId, pageSize: query.pageSize })
    const after = await decodeOptionalPageToken(c.get('platform'), query.pageToken, {
      query: fingerprint,
      codec: trashCursorCodec,
    })
    const result = await listTrashedObjects(c.get('deps'), { orgId, pageSize: query.pageSize, after })
    return c.json(
      {
        items: result.result.items.map(toMatterDTO),
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.result.nextBoundary, {
          query: fingerprint,
          codec: trashCursorCodec,
        }),
      },
      200,
    )
  })
  .openapi(getTrashObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const result = await getTrashObject(c.get('deps'), { orgId, objectId: c.req.valid('param').id })
    if (!result.ok) throw result.error
    return c.json(toMatterDTO(result.matter), 200)
  })
  .openapi(restoreObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    // NameConflictError from the restore (a same-named item appeared while
    // trashed) propagates to onError → 409.
    const result = await restoreObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      onConflict: c.req.valid('json').onConflict,
    })
    if (!result.ok) throw result.error
    return c.json(toMatterDTO(result.matter), 200)
  })
  .openapi(purgeObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const result = await deleteObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
    })
    if (!result.ok) throw notFound()
    return c.body(null, 204)
  })

export default trash
