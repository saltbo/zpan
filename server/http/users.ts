import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  deleteUser,
  deleteUsers,
  getUser,
  grantUserEntitlement,
  listUserEntitlements,
  listUsers,
  revokeUserEntitlement,
  setUserStatus,
  setUsersStatus,
  updateUserEntitlement,
} from '../usecases/user'

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
])

const grantEntitlementSchema = z.object({
  resourceType: z.literal('storage'),
  bytes: z.number().int().positive(),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})

const updateEntitlementSchema = z.object({
  bytes: z.number().int().positive().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
})

const app = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '20')))
    const search = c.req.query('search')

    return c.json(await listUsers(c.get('deps'), { page, pageSize, search }))
  })
  .get('/:id', async (c) => {
    const result = await getUser(c.get('deps'), c.req.param('id'))
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.user)
  })
  .patch('/batch', zValidator('json', batchPatchSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await setUsersStatus(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      ids: body.ids,
      status: body.action === 'disable' ? 'disabled' : 'active',
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json({ ...result.result, status: result.status })
  })
  .get('/:id/entitlements', async (c) => {
    const result = await listUserEntitlements(c.get('deps'), c.req.param('id'))
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .post('/:id/entitlements', zValidator('json', grantEntitlementSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await grantUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: c.req.param('id'),
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result, 201)
  })
  .patch('/:id/entitlements/:eid', zValidator('json', updateEntitlementSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await updateUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: c.req.param('id'),
      entitlementId: c.req.param('eid'),
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .delete('/:id/entitlements/:eid', async (c) => {
    const result = await revokeUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: c.req.param('id'),
      entitlementId: c.req.param('eid'),
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .delete('/batch', zValidator('json', userIdsSchema), async (c) => {
    const { ids } = c.req.valid('json')
    const result = await deleteUsers(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      ids,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .patch('/:id', zValidator('json', updateStatusSchema), async (c) => {
    const userId = c.req.param('id')
    const { status } = c.req.valid('json')
    const result = await setUserStatus(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      userId,
      status,
    })
    if (!result.ok) return c.json({ error: 'User not found' }, 404)
    return c.json({ id: userId, status })
  })
  .delete('/:id', async (c) => {
    const userId = c.req.param('id')
    const result = await deleteUser(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      userId,
    })
    if (!result.ok) return c.json({ error: 'User not found' }, 404)
    return c.json({ id: userId, deleted: true })
  })

export default app
