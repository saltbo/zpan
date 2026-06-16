import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import {
  copyObjectBodySchema,
  createMatterSchema,
  createObjectUploadSessionSchema,
  objectDraftSchema,
  objectStatusSchema,
  objectUploadSessionSchema,
  objectUploadStatusSchema,
  patchMatterSchema,
  presignObjectUploadPartsResponseSchema,
  presignObjectUploadPartsSchema,
  transferMatterSchema,
} from '../../shared/schemas'
import { mapDomainError } from '../lib/http-errors'
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

// `.openapi()` infers the handler context from the route's request schemas, but
// these handlers return many ad-hoc status/shape unions the response schemas
// don't enumerate, so each handler is cast `as never`. That erases the inferred
// context, so we re-assert the minimal surface the bodies use. Mirrors the
// pattern in http/downloads/download-tasks.ts.
type OpenAPIContext = Context<Env> & {
  req: Context<Env>['req'] & {
    valid(target: 'json'): unknown
  }
}

// Object output shape (StorageObject) for response docs. Response types never
// reach the frontend — callers go through unwrap<T>() — so this only feeds the
// OpenAPI document.
const matterSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    alias: z.string(),
    name: z.string(),
    type: z.string(),
    size: z.number().int(),
    dirtype: z.number().int(),
    parent: z.string(),
    object: z.string(),
    storageId: z.string(),
    status: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Matter')

const objectPageSchema = z
  .object({
    items: z.array(matterSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('ObjectPage')

const errorSchema = z.object({ error: z.string() })

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

const json = (schema: z.ZodType, description: string) => ({ content: { 'application/json': { schema } }, description })
const err = (description: string) => json(errorSchema, description)
const jsonBody = (schema: z.ZodType) => ({ body: { content: { 'application/json': { schema } }, required: true } })
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

async function objectUploadResponse(c: Context<Env>, action: () => Promise<unknown>, status: 200 | 201 = 200) {
  try {
    return c.json(await action(), status)
  } catch (error) {
    if (error instanceof ObjectUploadSessionError) {
      if (error.code === 'storage_failure') {
        return c.json({ error: error.message }, 502)
      }
      return c.json(
        { error: error.code === 'not_found' ? 'Not found' : 'Invalid upload session state' },
        error.code === 'not_found' ? 404 : 409,
      )
    }
    throw error
  }
}

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
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'get',
      path: '/',
      middleware: [requireTeamRole('viewer')] as const,
      request: { query: listObjectsQuerySchema },
      responses: { 200: json(objectPageSchema, 'Objects'), 400: err('No active organization'), 403: err('Forbidden') },
    }),
    (async (c: OpenAPIContext) => {
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
      return c.json(result.result)
    }) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'post',
      path: '/',
      middleware: [requireObjectWriteAccess] as const,
      request: jsonBody(createMatterSchema),
      responses: {
        201: json(objectDraftSchema, 'Created object draft with upload URL'),
        400: err('No active organization'),
        403: err('Forbidden'),
        409: err('Name conflict'),
        500: err('Storage not configured'),
      },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)

      try {
        const result = await createObject(c.get('deps'), {
          orgId,
          actor: objectActor(c),
          input: c.req.valid('json') as z.infer<typeof createMatterSchema>,
        })
        if (!result.ok) {
          if (result.reason === 'target_outside_authorization')
            return c.json({ error: 'Target folder is outside task authorization' }, 403)
          return c.json({ error: 'Storage not configured' }, 500)
        }
        if ('uploadUrl' in result)
          return c.json(
            { ...result.matter, uploadUrl: result.uploadUrl, contentDisposition: result.contentDisposition },
            201,
          )
        return c.json(result.matter, 201)
      } catch (e) {
        const mapped = mapDomainError(e)
        if (mapped) return c.json(mapped.json, mapped.status)
        throw e
      }
    }) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'post',
      path: '/{id}/uploads',
      middleware: [requireObjectWriteAccess] as const,
      request: { params: idParam, ...jsonBody(createObjectUploadSessionSchema) },
      responses: {
        201: json(objectUploadSessionSchema, 'Object multipart upload session'),
        400: err('Invalid upload session'),
        403: err('Forbidden'),
        404: err('Not found'),
        502: err('Storage failure'),
      },
    }),
    (async (c: OpenAPIContext) =>
      objectUploadResponse(
        c,
        () => {
          const orgId = c.get('orgId')
          if (!orgId) throw new ObjectUploadSessionError('not_found')
          return createUploadSession(c.get('deps'), {
            orgId,
            objectId: c.req.param('id') as string,
            actor: objectActor(c),
            partSize: (c.req.valid('json') as z.infer<typeof createObjectUploadSessionSchema>).partSize,
          })
        },
        201,
      )) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'post',
      path: '/{id}/uploads/{uploadSessionId}/parts',
      middleware: [requireObjectWriteAccess] as const,
      request: { params: sessionParams, ...jsonBody(presignObjectUploadPartsSchema) },
      responses: {
        200: json(presignObjectUploadPartsResponseSchema, 'Presigned multipart upload parts'),
        400: err('Invalid upload session'),
        403: err('Forbidden'),
        404: err('Not found'),
        502: err('Storage failure'),
      },
    }),
    (async (c: OpenAPIContext) =>
      objectUploadResponse(c, () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return presignUploadSessionParts(c.get('deps'), {
          orgId,
          objectId: c.req.param('id') as string,
          sessionId: c.req.param('uploadSessionId') as string,
          partNumbers: (c.req.valid('json') as z.infer<typeof presignObjectUploadPartsSchema>).partNumbers,
        })
      })) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'put',
      path: '/{id}/uploads/{uploadSessionId}/status',
      middleware: [requireObjectWriteAccess] as const,
      request: { params: sessionParams, ...jsonBody(objectUploadStatusSchema) },
      responses: {
        200: json(objectUploadSessionSchema, 'Completed object multipart upload session'),
        400: err('Invalid upload session'),
        403: err('Forbidden'),
        404: err('Not found'),
        502: err('Storage failure'),
      },
    }),
    (async (c: OpenAPIContext) =>
      objectUploadResponse(c, () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return patchUploadSession(c.get('deps'), {
          orgId,
          objectId: c.req.param('id') as string,
          sessionId: c.req.param('uploadSessionId') as string,
          input: { action: 'complete', parts: (c.req.valid('json') as z.infer<typeof objectUploadStatusSchema>).parts },
        })
      })) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'delete',
      path: '/{id}/uploads/{uploadSessionId}',
      middleware: [requireObjectWriteAccess] as const,
      request: { params: sessionParams },
      responses: {
        200: json(objectUploadSessionSchema, 'Aborted object multipart upload session'),
        400: err('Invalid upload session'),
        403: err('Forbidden'),
        404: err('Not found'),
      },
    }),
    (async (c: OpenAPIContext) =>
      objectUploadResponse(c, () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return patchUploadSession(c.get('deps'), {
          orgId,
          objectId: c.req.param('id') as string,
          sessionId: c.req.param('uploadSessionId') as string,
          input: { action: 'abort' },
        })
      })) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'get',
      path: '/{id}',
      middleware: [requireTeamRole('viewer')] as const,
      request: { params: idParam },
      responses: {
        200: json(matterSchema.extend({ downloadUrl: z.string().optional() }), 'Object'),
        400: err('No active organization'),
        402: err('Insufficient credits'),
        404: err('Not found'),
        422: err('Traffic quota exceeded'),
      },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)

      const result = await getObject(c.get('deps'), {
        orgId,
        objectId: c.req.param('id') as string,
        cloudBaseUrl: cloudBaseUrl(c),
      })
      if (result.ok) {
        if ('downloadUrl' in result) return c.json({ ...result.matter, downloadUrl: result.downloadUrl })
        return c.json(result.matter)
      }
      switch (result.reason) {
        case 'not_found':
          return c.json({ error: 'Not found' }, 404)
        case 'storage_not_found':
          return c.json({ error: 'Storage not found' }, 404)
        case 'quota_exceeded':
          return c.json({ error: 'Traffic quota exceeded' }, 422)
        case 'insufficient_credits':
          return c.json(
            { error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' },
            402,
          )
      }
    }) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'patch',
      path: '/{id}',
      middleware: [requireObjectWriteAccess] as const,
      request: { params: idParam, ...jsonBody(patchMatterSchema) },
      responses: { 200: json(matterSchema, 'Updated object'), 400: err('Bad request'), 404: err('Not found') },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)
      try {
        const result = await updateObject(c.get('deps'), {
          orgId,
          objectId: c.req.param('id') as string,
          actorId: actorId(c),
          input: c.req.valid('json') as z.infer<typeof patchMatterSchema>,
        })
        if (!result.ok) return c.json({ error: 'Not found' }, 404)
        return c.json(result.matter)
      } catch (e) {
        const mapped = mapDomainError(e)
        if (mapped) return c.json(mapped.json, mapped.status)
        return c.json({ error: (e as Error).message }, 400)
      }
    }) as never,
  )
  // Lifecycle transitions: { status:'active' } confirms a draft or restores from
  // trash (server picks by current state); { status:'trashed' } soft-deletes.
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'put',
      path: '/{id}/status',
      middleware: [requireObjectWriteAccess] as const,
      request: { params: idParam, ...jsonBody(objectStatusSchema) },
      responses: {
        200: json(matterSchema, 'Updated object'),
        400: err('No active organization'),
        403: err('Forbidden'),
        404: err('Not found'),
        422: err('Quota exceeded'),
      },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)
      const objectId = c.req.param('id') as string
      const { status, onConflict } = c.req.valid('json') as z.infer<typeof objectStatusSchema>

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
        return c.json(result.matter)
      }

      // status === 'active': confirm a draft, otherwise restore from trash.
      try {
        const confirmed = await confirmObject(c.get('deps'), { orgId, objectId, actorId: actorId(c), onConflict })
        if (confirmed.ok) return c.json(confirmed.matter)
        if (confirmed.reason === 'quota_exceeded') return c.json({ error: 'Quota exceeded' }, 422)
      } catch (e) {
        const mapped = mapDomainError(e)
        if (mapped) return c.json(mapped.json, mapped.status)
        throw e
      }
      try {
        const restored = await restoreObject(c.get('deps'), { orgId, objectId, actorId: actorId(c), onConflict })
        if (!restored.ok) return c.json({ error: 'Not found' }, 404)
        return c.json(restored.matter)
      } catch (e) {
        const mapped = mapDomainError(e)
        if (mapped) return c.json(mapped.json, mapped.status)
        throw e
      }
    }) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'delete',
      path: '/{id}',
      middleware: [requireTeamRole('editor')] as const,
      request: { params: idParam },
      responses: {
        200: json(
          z.object({ id: z.string(), deleted: z.literal(true), purged: z.number().int().optional() }),
          'Deleted object',
        ),
        400: err('No active organization'),
        404: err('Not found'),
        409: err('Object must be trashed before permanent deletion'),
      },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)
      const objectId = c.req.param('id') as string
      const result = await deleteObject(c.get('deps'), { orgId, objectId, userId: c.get('userId')! })
      if (result.ok) return c.json({ id: result.id, deleted: true, purged: result.purged })
      if (result.reason === 'not_trashed') {
        // A draft (upload never confirmed) is discarded directly; a live object
        // must be trashed before it can be permanently deleted.
        const cancelled = await cancelObject(c.get('deps'), { orgId, objectId, actorId: actorId(c) })
        if (cancelled.ok) return c.json({ id: cancelled.id, deleted: true, purged: false })
        return c.json({ error: 'Object must be trashed before permanent deletion' }, 409)
      }
      return c.json({ error: 'Not found' }, 404)
    }) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'post',
      path: '/{id}/copies',
      middleware: [requireTeamRole('editor')] as const,
      request: { params: idParam, ...jsonBody(copyObjectBodySchema) },
      responses: {
        201: json(matterSchema, 'Copied object'),
        400: err('No active organization'),
        404: err('Not found'),
      },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)

      const body = c.req.valid('json') as z.infer<typeof copyObjectBodySchema>
      try {
        const result = await copyObject(c.get('deps'), {
          orgId,
          userId: c.get('userId')!,
          input: { copyFrom: c.req.param('id') as string, parent: body.parent, onConflict: body.onConflict },
        })
        if (!result.ok) {
          if (result.reason === 'storage_not_found') return c.json({ error: 'Storage not found' }, 404)
          return c.json({ error: 'Not found' }, 404)
        }
        return c.json(result.matter, 201)
      } catch (e) {
        const mapped = mapDomainError(e)
        if (mapped) return c.json(mapped.json, mapped.status)
        throw e
      }
    }) as never,
  )
  .openapi(
    createRoute({
      tags: ['Objects'],
      method: 'post',
      path: '/{id}/transfers',
      middleware: [requireTeamRole('viewer')] as const,
      request: { params: idParam, ...jsonBody(transferMatterSchema) },
      responses: {
        201: json(
          z.object({ id: z.string(), sourceDeleted: z.boolean() }).openapi('TransferResult'),
          'Transferred object',
        ),
        400: err('Invalid transfer target'),
        403: err('Forbidden'),
        404: err('Not found'),
        422: err('Quota exceeded'),
      },
    }),
    (async (c: OpenAPIContext) => {
      const orgId = c.get('orgId')
      if (!orgId) return c.json({ error: 'No active organization' }, 400)

      const result = await transferObject(c.get('deps'), {
        orgId,
        userId: c.get('userId')!,
        objectId: c.req.param('id') as string,
        input: c.req.valid('json') as z.infer<typeof transferMatterSchema>,
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
      return c.json(result.result, 201)
    }) as never,
  )

export default objects
