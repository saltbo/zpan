import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { cursorPageQuerySchema, cursorPageSchema, restoreObjectSchema } from '@shared/schemas'
import { requireAuth, requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { deleteObject, getTrashObject, listTrashedObjects, restoreObject } from '../usecases/object'
import { badRequest, type Matter, notFound } from '../usecases/ports'
import { errorResponse, jsonBody, jsonContent } from './openapi'
import { decodePageToken, encodePageToken, pageQueryFingerprint } from './page-token'

// The trashed-object wire shape mirrors the live Matter model; trash is a
// grouping/view of `objects`, not a separate resource.
const matterSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    alias: z.string(),
    name: z.string(),
    type: z.string(),
    size: z.number().int().nullable(),
    dirtype: z.number().int().nullable(),
    parent: z.string(),
    object: z.string(),
    storageId: z.string(),
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
const idParam = z.object({ id: z.string() })

const listTrashRoute = createRoute({
  operationId: 'listTrashObjects',
  summary: 'List trashed objects',
  tags: ['Trash'],
  method: 'get',
  path: '/objects',
  middleware: [requireTeamRole('viewer')] as const,
  request: { query: cursorPageQuerySchema },
  responses: {
    200: jsonContent(trashPageSchema, 'Trashed objects (roots only)'),
    400: errorResponse('No active organization'),
  },
})

const getTrashObjectRoute = createRoute({
  operationId: 'getTrashObject',
  summary: 'Get trashed object',
  tags: ['Trash'],
  method: 'get',
  path: '/objects/{id}',
  middleware: [requireTeamRole('viewer')] as const,
  request: { params: idParam },
  responses: {
    200: jsonContent(matterSchema, 'Trashed object'),
    400: errorResponse('No active organization'),
    404: errorResponse('Not found'),
  },
})

const restoreObjectRoute = createRoute({
  operationId: 'restoreObject',
  summary: 'Restore trashed object',
  tags: ['Trash'],
  method: 'post',
  path: '/objects/{id}/restorations',
  middleware: [requireTeamRole('editor')] as const,
  request: { params: idParam, ...jsonBody(restoreObjectSchema) },
  responses: {
    200: jsonContent(matterSchema, 'Restored object'),
    400: errorResponse('No active organization'),
    404: errorResponse('Not found'),
    409: errorResponse('Name conflict'),
  },
})

const purgeObjectRoute = createRoute({
  operationId: 'purgeTrashObject',
  summary: 'Permanently delete trashed object',
  tags: ['Trash'],
  method: 'delete',
  path: '/objects/{id}',
  middleware: [requireTeamRole('editor')] as const,
  request: { params: idParam },
  responses: {
    204: { description: 'Permanently removed (recursive subtree purge)' },
    400: errorResponse('No active organization'),
    404: errorResponse('Not found'),
  },
})

const app = new OpenAPIHono<Env>()
app.use(requireAuth)

const trash = app
  .openapi(listTrashRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const query = c.req.valid('query')
    const fingerprint = await pageQueryFingerprint({ orgId, pageSize: query.pageSize })
    let after: { trashedAt: number; createdAt: Date; id: string } | undefined
    if (query.pageToken) {
      const boundary = await decodePageToken(c.get('platform'), query.pageToken, { query: fingerprint })
      if (
        typeof boundary.trashedAt !== 'number' ||
        typeof boundary.createdAt !== 'number' ||
        typeof boundary.id !== 'string'
      ) {
        throw badRequest('Invalid page token', 'INVALID_PAGE_TOKEN')
      }
      after = {
        trashedAt: boundary.trashedAt,
        createdAt: new Date(boundary.createdAt),
        id: boundary.id,
      }
    }
    const result = await listTrashedObjects(c.get('deps'), { orgId, pageSize: query.pageSize, after })
    return c.json(
      {
        items: result.result.items.map(toMatterDTO),
        nextPageToken: result.result.nextBoundary
          ? await encodePageToken(c.get('platform'), {
              query: fingerprint,
              boundary: {
                trashedAt: result.result.nextBoundary.trashedAt,
                createdAt: result.result.nextBoundary.createdAt.getTime(),
                id: result.result.nextBoundary.id,
              },
            })
          : null,
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
