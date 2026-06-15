import { zValidator } from '@hono/zod-validator'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import {
  copyMatterSchema,
  createMatterSchema,
  createObjectUploadSessionSchema,
  patchMatterSchema,
  patchObjectUploadSessionSchema,
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
  .patch(
    '/:id/uploads/:uploadSessionId',
    requireObjectWriteAccess,
    zValidator('json', patchObjectUploadSessionSchema),
    async (c) =>
      objectUploadResponse(c, () => {
        const orgId = c.get('orgId')
        if (!orgId) throw new ObjectUploadSessionError('not_found')
        return patchUploadSession(c.get('deps'), {
          orgId,
          objectId: c.req.param('id'),
          sessionId: c.req.param('uploadSessionId'),
          input: c.req.valid('json'),
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

    const body = c.req.valid('json')
    const principal = c.get('principal')
    if (principal?.kind === 'download-task-upload') {
      const authorized = await authorizeTaskUploadConfirm(c.get('deps'), {
        orgId,
        objectId: c.req.param('id'),
        action: body.action,
        taskId: principal.taskId,
        downloaderId: principal.downloaderId,
        targetFolder: principal.targetFolder,
      })
      if (!authorized.ok) {
        return c.json(
          { error: body.action !== 'confirm' ? 'Download task upload token can only confirm uploads' : 'Forbidden' },
          403,
        )
      }
    }

    switch (body.action) {
      case 'update': {
        try {
          const result = await updateObject(c.get('deps'), {
            orgId,
            objectId: c.req.param('id'),
            actorId: actorId(c),
            input: body,
          })
          if (!result.ok) return c.json({ error: 'Not found' }, 404)
          return c.json(result.matter)
        } catch (e) {
          const mapped = mapDomainError(e)
          if (mapped) return c.json(mapped.json, mapped.status)
          return c.json({ error: (e as Error).message }, 400)
        }
      }
      case 'confirm': {
        try {
          const result = await confirmObject(c.get('deps'), {
            orgId,
            objectId: c.req.param('id'),
            actorId: actorId(c),
            onConflict: body.onConflict,
          })
          if (!result.ok) {
            if (result.reason === 'quota_exceeded') return c.json({ error: 'Quota exceeded' }, 422)
            return c.json({ error: 'Not found or not in draft status' }, 404)
          }
          return c.json(result.matter)
        } catch (e) {
          const mapped = mapDomainError(e)
          if (mapped) return c.json(mapped.json, mapped.status)
          throw e
        }
      }
      case 'cancel': {
        const result = await cancelObject(c.get('deps'), { orgId, objectId: c.req.param('id'), actorId: actorId(c) })
        if (!result.ok) return c.json({ error: 'Not found or not in draft status' }, 404)
        return c.json({ id: result.id, cancelled: true })
      }
      case 'trash': {
        const result = await trashObject(c.get('deps'), { orgId, objectId: c.req.param('id'), actorId: actorId(c) })
        if (!result.ok) return c.json({ error: 'Not found' }, 404)
        return c.json(result.matter)
      }
      case 'restore': {
        try {
          const result = await restoreObject(c.get('deps'), {
            orgId,
            objectId: c.req.param('id'),
            actorId: actorId(c),
            onConflict: body.onConflict,
          })
          if (!result.ok) return c.json({ error: 'Not found' }, 404)
          return c.json(result.matter)
        } catch (e) {
          const mapped = mapDomainError(e)
          if (mapped) return c.json(mapped.json, mapped.status)
          throw e
        }
      }
    }
  })
  .delete('/:id', requireTeamRole('editor'), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)
    const result = await deleteObject(c.get('deps'), {
      orgId,
      objectId: c.req.param('id'),
      userId: c.get('userId')!,
    })
    if (!result.ok) {
      if (result.reason === 'not_trashed')
        return c.json({ error: 'Object must be trashed before permanent deletion' }, 409)
      return c.json({ error: 'Not found' }, 404)
    }
    return c.json({ id: result.id, deleted: true, purged: result.purged })
  })
  .post('/copy', requireTeamRole('editor'), zValidator('json', copyMatterSchema), async (c) => {
    const orgId = c.get('orgId')
    if (!orgId) return c.json({ error: 'No active organization' }, 400)

    try {
      const result = await copyObject(c.get('deps'), {
        orgId,
        userId: c.get('userId')!,
        input: c.req.valid('json'),
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
