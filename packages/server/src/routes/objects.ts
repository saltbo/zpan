import type { Context } from 'hono'
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  confirmUpload,
  copyMatter,
  createObject,
  getDetail,
  HttpError,
  listMatters,
  permanentDelete,
  updateMatter,
} from '../services/matter'

function handleError(c: Context<Env>, e: unknown) {
  if (e instanceof HttpError) return c.json({ error: e.message }, e.status)
  throw e
}

const app = new Hono<Env>()
  .use(requireAuth)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const parent = c.req.query('parent') ?? ''
    const status = c.req.query('status') ?? 'active'
    const page = Math.max(1, Math.floor(Number(c.req.query('page') ?? '1')))
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(c.req.query('pageSize') ?? '20'))))

    const result = await listMatters(db, orgId, parent, status, page, pageSize)
    return c.json(result)
  })
  .post('/', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const userId = c.get('userId')!
    const body = await c.req.json()

    try {
      const result = await createObject(db, orgId, userId, body)
      return c.json(result, 201)
    } catch (e) {
      return handleError(c, e)
    }
  })
  .patch('/:id/done', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const matterId = c.req.param('id')

    try {
      const matter = await confirmUpload(db, orgId, matterId)
      return c.json(matter)
    } catch (e) {
      return handleError(c, e)
    }
  })
  .get('/:id', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const matterId = c.req.param('id')

    try {
      const result = await getDetail(db, orgId, matterId)
      return c.json(result)
    } catch (e) {
      return handleError(c, e)
    }
  })
  .patch('/:id', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const matterId = c.req.param('id')
    const body = await c.req.json<{ name?: string; parent?: string }>()

    if (body.name === undefined && body.parent === undefined) {
      return c.json({ error: 'No update fields provided' }, 400)
    }

    try {
      const matter = await updateMatter(db, orgId, matterId, body)
      return c.json(matter)
    } catch (e) {
      return handleError(c, e)
    }
  })
  .post('/:id/copy', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const userId = c.get('userId')!
    const matterId = c.req.param('id')
    const body = await c.req.json<{ parent?: string }>()

    try {
      const matter = await copyMatter(db, orgId, userId, matterId, body.parent)
      return c.json(matter, 201)
    } catch (e) {
      return handleError(c, e)
    }
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const orgId = c.get('orgId')!
    const matterId = c.req.param('id')

    try {
      await permanentDelete(db, orgId, matterId)
      return c.json({ ok: true })
    } catch (e) {
      return handleError(c, e)
    }
  })

export default app
