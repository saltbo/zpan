import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import {
  copyObjectBodySchema,
  createMatterSchema,
  createObjectUploadSessionSchema,
  objectStatusSchema,
  objectUploadSessionSchema,
  objectUploadStatusSchema,
  patchMatterSchema,
  presignObjectUploadPartsResponseSchema,
  presignObjectUploadPartsSchema,
  transferMatterSchema,
} from '../../shared/schemas'
import { requireTeamRole } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  authorizeTaskUploadConfirm,
  cancelObject,
  confirmObject,
  copyObject,
  createObject,
  createUploadSession,
  deleteObject,
  getObject,
  hasEditorAccess,
  listObjects,
  type ObjectActor,
  ObjectUploadSessionError,
  patchUploadSession,
  presignUploadSessionParts,
  restoreObject,
  transferObject,
  trashObject,
  updateObject,
} from '../usecases/object'
import type { Matter } from '../usecases/ports'
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

const objectPageSchema = z
  .object({
    items: z.array(matterSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('ObjectPage')

// POST / returns the created object plus, for direct uploads, the presigned URL
// to PUT the bytes to.
const objectCreateResultSchema = matterSchema.extend({
  uploadUrl: z.string().optional(),
  contentDisposition: z.string().optional(),
})

// GET /{id} returns the object plus, when egress is metered/allowed, a presigned
// download URL.
const objectWithDownloadSchema = matterSchema.extend({ downloadUrl: z.string().optional() })

// A 402 carrying the credit-gated resource so clients can prompt a top-up.
const insufficientCreditsSchema = z.object({
  error: z.string(),
  code: z.string(),
  resource: z.string(),
})

// List endpoint reads query params ad-hoc; declared here for docs + RPC typing.
// All optional so callers may send any subset.
const listObjectsQuerySchema = z.object({
  parent: z.string().optional(),
  path: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  orgId: z.string().optional(),
})

const idParam = z.object({ id: z.string() })
const sessionParams = z.object({ id: z.string(), uploadSessionId: z.string() })

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
    return c.json({ error: c.get('userId') ? 'Forbidden' : 'Unauthorized' }, c.get('userId') ? 403 : 401)
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
    201: jsonContent(objectCreateResultSchema, 'Created object draft with upload URL'),
    400: errorResponse('No active organization'),
    403: errorResponse('Forbidden'),
    409: errorResponse('Name conflict'),
    500: errorResponse('Storage not configured'),
  },
})

const createUploadSessionRoute = createRoute({
  operationId: 'createObjectUploadSession',
  summary: 'Start multipart upload',
  tags: ['Objects'],
  method: 'post',
  path: '/{id}/uploads',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: idParam, ...jsonBody(createObjectUploadSessionSchema) },
  responses: {
    201: jsonContent(objectUploadSessionSchema, 'Object multipart upload session'),
    400: errorResponse('Invalid upload session'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    502: errorResponse('Storage failure'),
  },
})

const presignPartsRoute = createRoute({
  operationId: 'presignObjectUploadParts',
  summary: 'Presign upload parts',
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

const completeUploadRoute = createRoute({
  operationId: 'completeObjectUpload',
  summary: 'Complete multipart upload',
  tags: ['Objects'],
  method: 'put',
  path: '/{id}/uploads/{uploadSessionId}/status',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: sessionParams, ...jsonBody(objectUploadStatusSchema) },
  responses: {
    200: jsonContent(objectUploadSessionSchema, 'Completed object multipart upload session'),
    400: errorResponse('Invalid upload session'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    502: errorResponse('Storage failure'),
  },
})

const abortUploadRoute = createRoute({
  operationId: 'abortObjectUpload',
  summary: 'Abort multipart upload',
  tags: ['Objects'],
  method: 'delete',
  path: '/{id}/uploads/{uploadSessionId}',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: sessionParams },
  responses: {
    200: jsonContent(objectUploadSessionSchema, 'Aborted object multipart upload session'),
    400: errorResponse('Invalid upload session'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
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
    402: jsonContent(insufficientCreditsSchema, 'Insufficient credits'),
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

const objectStatusRoute = createRoute({
  operationId: 'setObjectStatus',
  summary: 'Change object status',
  tags: ['Objects'],
  method: 'put',
  path: '/{id}/status',
  middleware: [requireObjectWriteAccess] as const,
  request: { params: idParam, ...jsonBody(objectStatusSchema) },
  responses: {
    200: jsonContent(matterSchema, 'Updated object'),
    400: errorResponse('No active organization'),
    403: errorResponse('Forbidden'),
    404: errorResponse('Not found'),
    422: errorResponse('Quota exceeded'),
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
    200: jsonContent(
      // `purged` is the count of permanently removed items, or `false` when a
      // draft is discarded (nothing was purged).
      z.object({ id: z.string(), deleted: z.literal(true), purged: z.number().int().or(z.literal(false)) }),
      'Deleted object',
    ),
    400: errorResponse('No active organization'),
    404: errorResponse('Not found'),
    409: errorResponse('Object must be trashed before permanent deletion'),
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
  return c.json({ error: 'Unauthorized' }, 401)
})

const objects = app
  .openapi(listRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const result = await listObjects(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      orgOverride: c.req.query('orgId'),
      filters: {
        parent: c.req.query('path') ?? c.req.query('parent') ?? '',
        status: c.req.query('status') ?? 'active',
        typeFilter: c.req.query('type'),
        search: c.req.query('search'),
        page: Number(c.req.query('page') ?? '1'),
        pageSize: Number(c.req.query('pageSize') ?? '20'),
      },
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ ...result.result, items: result.result.items.map(toMatterDTO) }, 200)
  })
  .openapi(createObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const result = await createObject(c.get('deps'), { orgId, actor: objectActor(c), input: c.req.valid('json') })
    if (!result.ok) {
      if (result.reason === 'target_outside_authorization')
        return c.json({ error: 'Target folder is outside task authorization' }, 403)
      return c.json({ error: 'Storage not configured' }, 500)
    }
    if ('uploadUrl' in result)
      return c.json(
        { ...toMatterDTO(result.matter), uploadUrl: result.uploadUrl, contentDisposition: result.contentDisposition },
        201,
      )
    return c.json(toMatterDTO(result.matter), 201)
  })
  .openapi(createUploadSessionRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw new ObjectUploadSessionError('not_found')
    const session = await createUploadSession(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      actor: objectActor(c),
      partSize: c.req.valid('json').partSize,
    })
    return c.json(session, 201)
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
  .openapi(completeUploadRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw new ObjectUploadSessionError('not_found')
    const session = await patchUploadSession(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      sessionId: c.req.valid('param').uploadSessionId,
      input: { action: 'complete', parts: c.req.valid('json').parts },
    })
    return c.json(session, 200)
  })
  .openapi(abortUploadRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) throw new ObjectUploadSessionError('not_found')
    const session = await patchUploadSession(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      sessionId: c.req.valid('param').uploadSessionId,
      input: { action: 'abort' },
    })
    return c.json(session, 200)
  })
  .openapi(getObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const result = await getObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      cloudBaseUrl: cloudBaseUrl(c),
    })
    if (result.ok) {
      if ('downloadUrl' in result)
        return c.json({ ...toMatterDTO(result.matter), downloadUrl: result.downloadUrl }, 200)
      return c.json(toMatterDTO(result.matter), 200)
    }
    switch (result.reason) {
      case 'not_found':
        return c.json({ error: 'Not found' }, 404)
      case 'storage_not_found':
        return c.json({ error: 'Storage not found' }, 404)
      case 'quota_exceeded':
        return c.json({ error: 'Traffic quota exceeded' }, 422)
      case 'insufficient_credits':
        return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' }, 402)
    }
  })
  .openapi(patchObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const result = await updateObject(c.get('deps'), {
      orgId,
      objectId: c.req.valid('param').id,
      actorId: actorId(c),
      input: c.req.valid('json'),
    })
    if (!result.ok) return c.json({ error: 'Not found' }, 404)
    return c.json(toMatterDTO(result.matter), 200)
  })
  // Lifecycle transitions: { status:'active' } confirms a draft or restores from
  // trash (server picks by current state); { status:'trashed' } soft-deletes.
  .openapi(objectStatusRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const objectId = c.req.valid('param').id
    const { status, onConflict } = c.req.valid('json')

    const principal = c.get('principal')
    if (principal?.kind === 'download-task-upload') {
      // Upload tokens may only confirm their own draft.
      if (status !== 'active') {
        return c.json({ error: 'Download task upload token can only confirm uploads' }, 403)
      }
      const authorized = await authorizeTaskUploadConfirm(c.get('deps'), {
        orgId,
        objectId,
        taskId: principal.taskId,
        downloaderId: principal.downloaderId,
        targetFolder: principal.targetFolder,
      })
      if (!authorized.ok) return c.json({ error: 'Forbidden' }, 403)
    }

    if (status === 'trashed') {
      const result = await trashObject(c.get('deps'), { orgId, objectId, actorId: actorId(c) })
      if (!result.ok) return c.json({ error: 'Not found' }, 404)
      return c.json(toMatterDTO(result.matter), 200)
    }

    // status === 'active': confirm a draft, otherwise restore from trash.
    // NameConflictError / StorageQuotaExceededError thrown here propagate to the
    // global onError, which maps them to 409 / 422.
    const confirmed = await confirmObject(c.get('deps'), { orgId, objectId, actorId: actorId(c), onConflict })
    if (confirmed.ok) return c.json(toMatterDTO(confirmed.matter), 200)
    if (confirmed.reason === 'quota_exceeded') return c.json({ error: 'Quota exceeded' }, 422)

    const restored = await restoreObject(c.get('deps'), { orgId, objectId, actorId: actorId(c), onConflict })
    if (!restored.ok) return c.json({ error: 'Not found' }, 404)
    return c.json(toMatterDTO(restored.matter), 200)
  })
  .openapi(deleteObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const objectId = c.req.valid('param').id
    const result = await deleteObject(c.get('deps'), { orgId, objectId, userId: c.get('userId')! })
    if (result.ok) return c.json({ id: result.id, deleted: true as const, purged: result.purged }, 200)
    if (result.reason === 'not_trashed') {
      // A draft (upload never confirmed) is discarded directly; a live object
      // must be trashed before it can be permanently deleted.
      const cancelled = await cancelObject(c.get('deps'), { orgId, objectId, actorId: actorId(c) })
      if (cancelled.ok) return c.json({ id: cancelled.id, deleted: true as const, purged: false as const }, 200)
      return c.json({ error: 'Object must be trashed before permanent deletion' }, 409)
    }
    return c.json({ error: 'Not found' }, 404)
  })
  .openapi(copyObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const body = c.req.valid('json')
    const result = await copyObject(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      input: { copyFrom: c.req.valid('param').id, parent: body.parent, onConflict: body.onConflict },
    })
    if (!result.ok) {
      if (result.reason === 'storage_not_found') return c.json({ error: 'Storage not found' }, 404)
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json(toMatterDTO(result.matter), 201)
  })
  .openapi(transferObjectRoute, async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const result = await transferObject(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      objectId: c.req.valid('param').id,
      input: c.req.valid('json'),
    })
    if (!result.ok) {
      switch (result.reason) {
        case 'same_org':
          return c.json({ error: 'Target must be a different space', code: 'SAME_ORG' }, 400)
        case 'not_found':
          return c.json({ error: 'Not found' }, 404)
        case 'forbidden':
          return c.json({ error: 'Forbidden' }, 403)
        case 'quota_exceeded':
          return c.json({ error: 'Quota exceeded', code: 'QUOTA_EXCEEDED' }, 422)
      }
    }
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
