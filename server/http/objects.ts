import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import {
  copyObjectBodySchema,
  createMatterSchema,
  createObjectUploadSessionSchema,
  objectStatusSchema,
  objectUploadStatusSchema,
  patchMatterSchema,
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

const app = new Hono<Env>()
  .use(async (c, next) => {
    const principal = c.get('principal')
    if (c.get('userId') || principal?.kind === 'download-task-upload') {
      await next()
      return
    }
    return c.json({ error: 'Unauthorized' }, 401)
  })
  .get('/', requireTeamRole('viewer'), async (c) => {
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
  })
  .post('/', requireObjectWriteAccess, zValidator('json', createMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    try {
      const result = await createObject(c.get('deps'), { orgId, actor: objectActor(c), input: c.req.valid('json') })
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
  })
  .post('/:id/uploads', requireObjectWriteAccess, zValidator('json', createObjectUploadSessionSchema), async (c) =>
    objectUploadResponse(
      c,
      () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return createUploadSession(c.get('deps'), {
          orgId,
          objectId: c.req.param('id'),
          actor: objectActor(c),
          partSize: c.req.valid('json').partSize,
        })
      },
      201,
    ),
  )
  .post(
    '/:id/uploads/:uploadSessionId/parts',
    requireObjectWriteAccess,
    zValidator('json', presignObjectUploadPartsSchema),
    async (c) =>
      objectUploadResponse(c, () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return presignUploadSessionParts(c.get('deps'), {
          orgId,
          objectId: c.req.param('id'),
          sessionId: c.req.param('uploadSessionId'),
          partNumbers: c.req.valid('json').partNumbers,
        })
      }),
  )
  .put(
    '/:id/uploads/:uploadSessionId/status',
    requireObjectWriteAccess,
    zValidator('json', objectUploadStatusSchema),
    async (c) =>
      objectUploadResponse(c, () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return patchUploadSession(c.get('deps'), {
          orgId,
          objectId: c.req.param('id'),
          sessionId: c.req.param('uploadSessionId'),
          input: { action: 'complete', parts: c.req.valid('json').parts },
        })
      }),
  )
  .delete('/:id/uploads/:uploadSessionId', requireObjectWriteAccess, async (c) =>
    objectUploadResponse(c, () => {
      const orgId = c.get('orgId')
      if (!orgId) throw new ObjectUploadSessionError('not_found')
      return patchUploadSession(c.get('deps'), {
        orgId,
        objectId: c.req.param('id'),
        sessionId: c.req.param('uploadSessionId'),
        input: { action: 'abort' },
      })
    }),
  )
  .get('/:id', requireTeamRole('viewer'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const result = await getObject(c.get('deps'), {
      orgId,
      objectId: c.req.param('id'),
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
        return c.json({ error: 'insufficient_credits', code: 'insufficient_credits', resource: 'storage_egress' }, 402)
    }
  })
  .patch('/:id', requireObjectWriteAccess, zValidator('json', patchMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    try {
      const result = await updateObject(c.get('deps'), {
        orgId,
        objectId: c.req.param('id'),
        actorId: actorId(c),
        input: c.req.valid('json'),
      })
      if (!result.ok) return c.json({ error: 'Not found' }, 404)
      return c.json(result.matter)
    } catch (e) {
      const mapped = mapDomainError(e)
      if (mapped) return c.json(mapped.json, mapped.status)
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  // Lifecycle transitions: { status:'active' } confirms a draft or restores from
  // trash (server picks by current state); { status:'trashed' } soft-deletes.
  .put('/:id/status', requireObjectWriteAccess, zValidator('json', objectStatusSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const objectId = c.req.param('id')
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
  })
  .delete('/:id', requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const objectId = c.req.param('id')
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
  })
  .post('/:id/copies', requireTeamRole('editor'), zValidator('json', copyObjectBodySchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const body = c.req.valid('json')
    try {
      const result = await copyObject(c.get('deps'), {
        orgId,
        userId: c.get('userId')!,
        input: { copyFrom: c.req.param('id'), parent: body.parent, onConflict: body.onConflict },
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
  })
  .post('/:id/transfers', requireTeamRole('viewer'), zValidator('json', transferMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    const result = await transferObject(c.get('deps'), {
      orgId,
      userId: c.get('userId')!,
      objectId: c.req.param('id'),
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
    return c.json(result.result, 201)
  })

export default app
