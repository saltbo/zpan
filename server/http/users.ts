import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../middleware/auth'
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
} from '../usecases/console/user'
import { removeAvatar, updateAvatar } from '../usecases/me'
import { getPublicProfile } from '../usecases/profile'

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

// The `:username` path slot accepts either the public username handle (profile
// URLs) or the internal user id (the admin console routes by id). Try the id
// directly first; otherwise resolve the username via the existing `listUsers`
// search (which returns UserWithOrg.id) and pick the exact match. Returns null
// when absent → 404.
async function resolveUserId(deps: Env['Variables']['deps'], handle: string): Promise<string | null> {
  const byId = await getUser(deps, handle)
  if (byId.ok) return handle
  const { items } = await listUsers(deps, { page: 1, pageSize: 100, search: handle })
  return items.find((u) => u.username === handle)?.id ?? null
}

// One users resource. `/me/avatar` is the self-scoped avatar mutation; the
// collection routes are admin user management; `GET /:username` is public but
// role-branches to an admin detail view for admins; the remaining `/:username`
// routes are admin-only. Static paths (`/me/*`, `/`) are registered before the
// `:username` param routes so they win.
export const users = new Hono<Env>()
  .put('/me/avatar', requireAuth, async (c) => {
    // Multipart parsing + File extraction are http concerns; the usecase
    // receives the already-extracted File.
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'Expected multipart/form-data with a file field' }, 415)

    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)

    const result = await updateAvatar(c.get('deps'), {
      platform: c.get('platform'),
      userId: c.get('userId') as string,
      file,
    })
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json({ url: result.url })
  })
  .delete('/me/avatar', requireAuth, async (c) => {
    await removeAvatar(c.get('deps'), {
      platform: c.get('platform'),
      userId: c.get('userId') as string,
    })
    return c.json({ ok: true })
  })
  .get('/', requireAdmin, async (c) => {
    const page = Math.max(1, Number(c.req.query('page') ?? '1'))
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '20')))
    const search = c.req.query('search')

    return c.json(await listUsers(c.get('deps'), { page, pageSize, search }))
  })
  .patch('/', requireAdmin, zValidator('json', batchPatchSchema), async (c) => {
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
  .delete('/', requireAdmin, zValidator('json', userIdsSchema), async (c) => {
    const { ids } = c.req.valid('json')
    const result = await deleteUsers(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      ids,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .get('/:username', async (c) => {
    const username = c.req.param('username')
    // Admins get the full management detail; everyone else gets the public profile.
    if (c.get('userRole') === 'admin') {
      const id = await resolveUserId(c.get('deps'), username)
      if (!id) return c.json({ error: 'User not found' }, 404)
      const result = await getUser(c.get('deps'), id)
      if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
      return c.json(result.user)
    }
    const user = await getPublicProfile(c.get('deps'), username)
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({ user, shares: [] })
  })
  .get('/:username/objects', async (c) => {
    const user = await getPublicProfile(c.get('deps'), c.req.param('username'))
    if (!user) return c.json({ error: 'User not found' }, 404)
    return c.json({ items: [], breadcrumb: [] })
  })
  .patch('/:username', requireAdmin, zValidator('json', updateStatusSchema), async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.param('username'))
    if (!id) return c.json({ error: 'User not found' }, 404)
    const { status } = c.req.valid('json')
    const result = await setUserStatus(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      userId: id,
      status,
    })
    if (!result.ok) return c.json({ error: 'User not found' }, 404)
    return c.json({ id, status })
  })
  .delete('/:username', requireAdmin, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.param('username'))
    if (!id) return c.json({ error: 'User not found' }, 404)
    const result = await deleteUser(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      userId: id,
    })
    if (!result.ok) return c.json({ error: 'User not found' }, 404)
    return c.json({ id, deleted: true })
  })
  .get('/:username/entitlements', requireAdmin, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.param('username'))
    if (!id) return c.json({ error: 'User not found' }, 404)
    const result = await listUserEntitlements(c.get('deps'), id)
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .post('/:username/entitlements', requireAdmin, zValidator('json', grantEntitlementSchema), async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.param('username'))
    if (!id) return c.json({ error: 'User not found' }, 404)
    const body = c.req.valid('json')
    const result = await grantUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: id,
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result, 201)
  })
  .patch('/:username/entitlements/:eid', requireAdmin, zValidator('json', updateEntitlementSchema), async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.param('username'))
    if (!id) return c.json({ error: 'User not found' }, 404)
    const body = c.req.valid('json')
    const result = await updateUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: id,
      entitlementId: c.req.param('eid'),
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .delete('/:username/entitlements/:eid', requireAdmin, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.param('username'))
    if (!id) return c.json({ error: 'User not found' }, 404)
    const result = await revokeUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: id,
      entitlementId: c.req.param('eid'),
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
