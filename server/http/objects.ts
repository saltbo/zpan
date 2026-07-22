import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  completeObjectUploadSchema,
  copyObjectBodySchema,
  createMatterSchema,
  objectUploadInstructionsSchema,
  pageQuerySchema,
  pageSchema,
  patchMatterSchema,
  presignObjectUploadPartsResponseSchema,
  presignObjectUploadPartsSchema,
  transferMatterSchema,
} from '@shared/schemas'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { transferAuditActor } from '../middleware/audit-transfers'
import { requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  abortUpload,
  authorizeTaskUploadConfirm,
  completeUpload,
  copyObject,
  createObject,
  getObject,
  hasEditorAccess,
  listObjects,
  type ObjectActor,
  ObjectUploadSessionError,
  presignUploadSessionParts,
  transferObject,
  trashObject,
  updateObject,
} from '../usecases/object'
import { badRequest, forbidden, type Matter, unauthorized } from '../usecases/ports'
import { recordDownloadIssued } from '../usecases/transfer-activity'
import { errorResponse, jsonBody, jsonContent } from './openapi'

// The wire shape of a file/folder — exactly what the API serializes. Timestamps
// are strings here (the domain `Matter` carries them as `Date`); `toMatterDTO`
// below bridges the two, so this schema is provably what handlers return. Doc-only
// for the frontend (callers go through `unwrap<T>()`), but the single source the
// OpenAPI document and SDKs derive the `Matter` model from.
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
  .openapi('Matter')

type MatterDTO = z.infer<typeof matterSchema>

// The one place the domain `Matter` crosses to the wire: serialize `Date`
// timestamps to ISO strings, pass everything else through. Its return type is the
// schema's inferred type, so a drift between `Matter` and `matterSchema` is a
// compile error — not a silent lie in the document.
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

const objectPageSchema = pageSchema(matterSchema, 'ObjectPage')

// POST / returns the created object plus, for a file draft, the upload
// instructions: the server-decided part size and the presigned URLs to PUT each
// slice to (1 URL = single PutObject, N URLs = multipart).
const objectCreateResultSchema = matterSchema.extend({ upload: objectUploadInstructionsSchema.optional() })

// GET /{id} returns the object plus, when egress is metered/allowed, a presigned
// download URL.
const objectWithDownloadSchema = matterSchema.extend({ downloadUrl: z.string().optional() })

// List endpoint reads query params ad-hoc; declared here for docs + RPC typing.
// The non-pagination filters are optional so callers may send any subset; `page`
// comes from the shared integer-coerced pagination schema. The file manager loads a
// whole folder client-side (no UI paging, FILES_PAGE_SIZE=500), so this list
// overrides the shared pageSize cap of 100 with a higher ceiling — the rest of the
// API keeps the 100 default. Live objects only — the recycle bin is GET /trash/objects.
const listObjectsQuerySchema = pageQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(1000).default(20),
  parent: z.string().optional(),
  path: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  orgId: z.string().optional(),
})

const idParam = z.object({ id: z.string() })
const sessionParams = z.object({ id: z.string(), uploadSessionId: z.string() })
const abortUploadQuerySchema = z.object({
  strictStorageCleanup: z.enum(['1', 'true']).optional(),
})

// The caller acting on objects: a download-task-upload token acts on behalf of
// the task creator; otherwise it is the authenticated user.
function objectActor(c: Context<Env>): ObjectActor {
  const principal = c.get('principal')
  if (principal?.kind === 'download-task-upload') {
    return {
      kind: 'download-task-upload',
      downloaderId: principal.downloaderId,
      taskId: principal.taskId,
      targetFolder: principal.targetFolder,
      createdByUserId: principal.createdByUserId,
    }
  }
  return { kind: 'user', userId: c.get('userId') as string }
}

// The id recorded in matter/activity logs.
function actorId(c: Context<Env>): string {
  const principal = c.get('principal')
  if (principal?.kind === 'download-task-upload') return `downloader:${principal.downloaderId}`
  return c.get('userId') ?? 'system'
}

const cloudBaseUrl = (c: Context<Env>) => c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT

const requireObjectWriteAccess = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind === 'download-task-upload') {
    await next()
    return
  }
  if (!(await hasEditorAccess(c.get('deps'), { orgId: c.get('orgId'), userId: c.get('userId') }))) {
    if (c.get('userId')) throw forbidden()
    throw unauthorized()
  }
  await next()
})

const listRoute = createRoute({
  operationId: 'listObjects',
  summary: 'List objects',
  tags: ['Objects'],
  method: 'get',
  path: '/',
  middleware: [requireTeamRole('viewer')] as const,
  request: { query: listObjectsQuerySchema },
  responses: {
    200: jsonContent(objectPageSchema, 'Objects'),
    400: errorResponse('No active organization'),
    403: errorResponse('Forbidden'),
  },
})

const createObjectRoute = createRoute({
  operationId: 'createObject',
  summary: 'Create object',
  tags: ['Objects'],
  method: 'post',
  path: '/',
  middleware: [requireObjectWriteAccess] as const,
  request: jsonBody(createMatterSchema),
  responses: {
    201: jsonContent(objectCreateResultSchema, 'Created object (folder, or file draft with upload instructions)'),
    400: errorResponse('No active organization or file too large'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Name conflict'),
    503: errorResponse('No storage configured'),
  },
})

const presignPartsRoute = createRoute({
  operationId: 'presignObjectUploadParts',
  summary: 'Re-presign upload parts',
  tags: ['Objects'],
  method: 'post',
  path: '/{id}/uploads/{uploadSessionId}/parts',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: sessionParams, ...jsonBody(presignObjectUploadPartsSchema) },
  responses: {
    200: jsonContent(presignObjectUploadPartsResponseSchema, 'Presigned multipart upload parts'),
    400: errorResponse('Invalid upload session'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    502: errorResponse('Storage failure'),
  },
})

const completionsRoute = createRoute({
  operationId: 'completeObjectUpload',
  summary: 'Complete upload',
  tags: ['Objects'],
  method: 'post',
  path: '/{id}/uploads/{uploadSessionId}/completions',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: sessionParams, ...jsonBody(completeObjectUploadSchema) },
  responses: {
    200: jsonContent(matterSchema, 'Finalized live object'),
    400: errorResponse('Invalid upload session'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    422: errorResponse('Quota exceeded'),
    502: errorResponse('Storage failure'),
  },
})

const abortUploadRoute = createRoute({
  operationId: 'abortObjectUpload',
  summary: 'Abort upload',
  tags: ['Objects'],
  method: 'delete',
  path: '/{id}/uploads/{uploadSessionId}',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: sessionParams, query: abortUploadQuerySchema },
  responses: {
    204: { description: 'Aborted upload and discarded the draft' },
    400: errorResponse('Invalid upload session'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    502: errorResponse('Storage cleanup failed'),
  },
})

const getObjectRoute = createRoute({
  operationId: 'getObject',
  summary: 'Get object',
  tags: ['Objects'],
  method: 'get',
  path: '/{id}',
  middleware: [requireTeamRole('viewer')] as const,
  request: { params: idParam },
  responses: {
    200: jsonContent(objectWithDownloadSchema, 'Object'),
    400: errorResponse('No active organization'),
    402: errorResponse('Insufficient credits'),
    404: errorResponse('Not found'),
    422: errorResponse('Traffic quota exceeded'),
  },
})

const patchObjectRoute = createRoute({
  operationId: 'updateObject',
  summary: 'Update object',
  tags: ['Objects'],
  method: 'patch',
  path: '/{id}',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: idParam, ...jsonBody(patchMatterSchema) },
  responses: {
    200: jsonContent(matterSchema, 'Updated object'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const deleteObjectRoute = createRoute({
  operationId: 'deleteObject',
  summary: 'Delete object',
  tags: ['Objects'],
  method: 'delete',
  path: '/{id}',
  middleware: [requireTeamRole('editor')] as const,
  request: { params: idParam },
  responses: {
    // Soft delete: the object moves to trash (GET /trash/objects). Permanent
    // removal is DELETE /trash/objects/{id}.
    204: { description: 'Object moved to trash' },
    400: errorResponse('No active organization'),
    404: errorResponse('Not found'),
  },
})

const copyObjectRoute = createRoute({
  operationId: 'copyObject',
  summary: 'Copy object',
  tags: ['Objects'],
  method: 'post',
  path: '/{id}/copies',
  middleware: [requireTeamRole('editor')] as const,
  request: { params: idParam, ...jsonBody(copyObjectBodySchema) },
  responses: {
    201: jsonContent(matterSchema, 'Copied object'),
    400: errorResponse('No active organization'),
    404: errorResponse('Not found'),
  },
})

const transferObjectRoute = createRoute({
  operationId: 'transferObject',
  summary: 'Transfer object to another space',
  tags: ['Objects'],
  method: 'post',
  path: '/{id}/transfers',
  middleware: [requireTeamRole('viewer')] as const,
  request: { params: idParam, ...jsonBody(transferMatterSchema) },
  responses: {
    201: jsonContent(
      z
        .object({
          saved: z.array(matterSchema),
          skipped: z.array(z.object({ name: z.string(), reason: z.string() })),
          sourceDeleted: z.boolean(),
        })
        .openapi('TransferResult'),
      'Transferred object',
    ),
    400: errorResponse('Invalid transfer target'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    422: errorResponse('Quota exceeded'),
  },
})

const app = new OpenAPIHono<Env>()
// Blanket auth gate for every object route. Applied as a statement, not chained,
// because `.use()` returns the base Hono type and would strip `.openapi()`.
app.use(async (c, next) => {
  const principal = c.get('principal')
  if (c.get('userId') || principal?.kind === 'download-task-upload') {
    await next()
    return
  }
  throw unauthorized()
})

const objects = app
  .openapi(listRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')

    const query = c.req.valid('query')
    const result = await listObjects(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      orgOverride: query.orgId,
      filters: {
        parent: query.path ?? query.parent ?? '',
        typeFilter: query.type,
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      },
    })
    if (!result.ok) throw result.error
    return c.json({ ...result.result, items: result.result.items.map(toMatterDTO) }, 200)
  })
  .openapi(createObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')

    const input = c.req.valid('json')
    if (input.storageId && c.get('userRole') !== 'admin') throw forbidden('Forbidden')

    const result = await createObject(c.get('deps'), { orgId, actor: objectActor(c), input })
    if (!result.ok) throw result.error
    if ('upload' in result) return c.json({ ...toMatterDTO(result.matter), upload: result.upload }, 201)
    return c.json(toMatterDTO(result.matter), 201)
  })
  .openapi(presignPartsRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw new ObjectUploadSessionError('not_found')
    const result = await presignUploadSessionParts(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      sessionId: c.req.valid('param').uploadSessionId,
      partNumbers: c.req.valid('json').partNumbers,
    })
    return c.json(result, 200)
  })
  // Finalize the upload (draft → live). The client has PUT every slice and read
  // its ETag; the server HEADs (single PutObject) or CompleteMultipartUpload,
  // then activates the draft. NameConflictError / StorageQuotaExceededError thrown
  // by the activation propagate to onError (409 / 422).
  .openapi(completionsRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw new ObjectUploadSessionError('not_found')
    const objectId = c.req.valid('param').id

    const principal = c.get('principal')
    if (principal?.kind === 'download-task-upload') {
      const authorized = await authorizeTaskUploadConfirm(c.get('deps'), {
        orgId,
        objectId,
        taskId: principal.taskId,
        downloaderId: principal.downloaderId,
        targetFolder: principal.targetFolder,
      })
      if (!authorized.ok) throw authorized.error
    }

    const result = await completeUpload(c.get('deps'), {
      orgId,
      objectId,
      sessionId: c.req.valid('param').uploadSessionId,
      parts: c.req.valid('json').parts,
      actorId: actorId(c),
    })
    if (!result.ok) {
      if ('error' in result) throw result.error // quota exceeded
      throw new ObjectUploadSessionError('not_found') // draft gone
    }
    return c.json(toMatterDTO(result.matter), 200)
  })
  .openapi(abortUploadRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw new ObjectUploadSessionError('not_found')
    await abortUpload(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      sessionId: c.req.valid('param').uploadSessionId,
      actorId: actorId(c),
      strictStorageCleanup: c.req.valid('query').strictStorageCleanup !== undefined,
    })
    return c.body(null, 204)
  })
  .openapi(getObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')

    const result = await getObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      cloudBaseUrl: cloudBaseUrl(c),
    })
    if (result.ok) {
      if ('downloadUrl' in result) {
        await recordDownloadIssued(
          c.get('deps'),
          transferAuditActor(c.get('principal')),
          'object_download',
          {
            orgId,
            targetType: 'file',
            targetId: result.matter.id,
            targetName: result.matter.name,
            bytes: result.receipt.bytes,
            source: 'object_download',
            metadata: { matterId: result.matter.id, storageId: result.receipt.storageId },
          },
          result.receipt.trafficEventId,
        )
        return c.json({ ...toMatterDTO(result.matter), downloadUrl: result.downloadUrl }, 200)
      }
      return c.json(toMatterDTO(result.matter), 200)
    }
    throw result.error
  })
  .openapi(patchObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const result = await updateObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(toMatterDTO(result.matter), 200)
  })
  // Soft delete: move a live object to trash. Permanent removal is
  // DELETE /trash/objects/{id}; discarding a draft is DELETE /{id}/uploads/{sid}.
  .openapi(deleteObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')
    const result = await trashObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
    })
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })
  .openapi(copyObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')

    const body = c.req.valid('json')
    const result = await copyObject(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      input: { copyFrom: c.req.valid('param').id, parent: body.parent, onConflict: body.onConflict },
    })
    if (!result.ok) throw result.error
    return c.json(toMatterDTO(result.matter), 201)
  })
  .openapi(transferObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw badRequest('No active organization')

    const result = await transferObject(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      objectId: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (!result.ok) throw result.error
    return c.json(
      {
        saved: result.result.saved.map(toMatterDTO),
        skipped: result.result.skipped,
        sourceDeleted: result.result.sourceDeleted,
      },
      201,
    )
  })

export default objects
