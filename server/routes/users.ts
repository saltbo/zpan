import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import {
  deleteUser,
  deleteUsers,
  listUsers,
  setUserStatus,
  setUsersPersonalQuota,
  setUsersStatus,
} from '../services/user'

const updateStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
})

const userIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
})

const batchPatchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.enum(['disable', 'enable']),
    ids: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    action: z.literal('set_quota'),
    ids: z.array(z.string().min(1)).min(1),
    quota: z.number().int().positive(),
  }),
])

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '20')))
    const search = c.req.query('search')

    const result = await listUsers(db, page, pageSize, search)
    return c.json(result)
  })
  .patch('/batch', zValidator('json', batchPatchSchema), async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const orgId = c.get('orgId')!
    const body = c.req.valid('json')

    if (body.action === 'set_quota') {
      const result = await setUsersPersonalQuota(db, body.ids, body.quota)
      if ('error' in result) return c.json({ error: result.error }, result.status)

      await recordActivity(db, {
        orgId,
        userId: adminUserId,
        action: 'quota_update',
        targetType: 'quota',
        targetName: 'batch',
        metadata: result,
      })
      return c.json(result)
    }

    const status = body.action === 'disable' ? 'disabled' : 'active'
    const result = await setUsersStatus(db, body.ids, status)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    await recordActivity(db, {
      orgId,
      userId: adminUserId,
      action: status === 'disabled' ? 'user_disable' : 'user_enable',
      targetType: 'user',
      targetName: 'batch',
      metadata: { ...result, status },
    })
    return c.json({ ...result, status })
  })
  .delete('/batch', zValidator('json', userIdsSchema), async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const orgId = c.get('orgId')!
    const { ids } = c.req.valid('json')

    const result = await deleteUsers(db, ids)
    if ('error' in result) return c.json({ error: result.error }, result.status)

    await recordActivity(db, {
      orgId,
      userId: adminUserId,
      action: 'user_delete',
      targetType: 'user',
      targetName: 'batch',
      metadata: result,
    })
    return c.json(result)
  })
  .patch('/:id', zValidator('json', updateStatusSchema), async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const orgId = c.get('orgId')!
    const userId = c.req.param('id')
    const { status } = c.req.valid('json')

    const updated = await setUserStatus(db, userId, status)
    if (!updated) {
      return c.json({ error: 'User not found' }, 404)
    }

    const action = status === 'disabled' ? 'user_disable' : 'user_enable'
    await recordActivity(db, {
      orgId,
      userId: adminUserId,
      action,
      targetType: 'user',
      targetId: userId,
      targetName: userId,
      metadata: { status },
    })

    return c.json({ id: userId, status })
  })
  .delete('/:id', async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const orgId = c.get('orgId')!
    const userId = c.req.param('id')

    const deleted = await deleteUser(db, userId)
    if (!deleted) {
      return c.json({ error: 'User not found' }, 404)
    }

    await recordActivity(db, {
      orgId,
      userId: adminUserId,
      action: 'user_delete',
      targetType: 'user',
      targetId: userId,
      targetName: userId,
    })

    return c.json({ id: userId, deleted: true })
  })

export default app
