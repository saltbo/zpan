import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageQuerySchema, pageSchema } from '@shared/schemas'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { UserWithOrg } from '../usecases/ports'
import {
  deleteUser,
  deleteUsers,
  getPublicProfile,
  getUser,
  grantUserEntitlement,
  listUserEntitlements,
  listUsers,
  removeAvatar,
  revokeUserEntitlement,
  setUserStatus,
  setUsersStatus,
  updateAvatar,
  updateUserEntitlement,
} from '../usecases/user'
import {
  entitlementListSchema,
  entitlementResultSchema,
  toEntitlementResultDTO,
  toQuotaEntitlementDTO,
} from './entitlements'
import { apiError, errorResponse, jsonBody, jsonContent } from './openapi'

const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    role: z.string().nullable(),
    banned: z.boolean().nullable(),
    createdAt: z.string(),
    orgId: z.string().nullable(),
    orgName: z.string().nullable(),
    quotaUsed: z.number().int(),
    quotaDefault: z.number().int(),
    quotaTotal: z.number().int(),
  })
  .openapi('User')

function toUserDTO(u: UserWithOrg): z.infer<typeof userSchema> {
  return { ...u, createdAt: u.createdAt.toISOString() }
}

const userListSchema = pageSchema(userSchema, 'UserList')

const publicUserSchema = z
  .object({ username: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi('PublicUser')

// GET /{username} returns the full admin record to admins, or a public profile
// wrapper to everyone else.
const userDetailSchema = z
  .union([userSchema, z.object({ user: publicUserSchema, shares: z.array(z.unknown()) })])
  .openapi('UserDetail')

const updateStatusSchema = z.object({ status: z.enum(['active', 'disabled']) })
const userIdsSchema = z.object({ ids: z.array(z.string().min(1)).min(1) })
const batchPatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['disable', 'enable']), ids: z.array(z.string().min(1)).min(1) }),
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

async function resolveUserId(deps: Env['Variables']['deps'], handle: string): Promise<string | null> {
  const byId = await getUser(deps, handle)
  if (byId.ok) return handle
  const { items } = await listUsers(deps, { page: 1, pageSize: 100, search: handle })
  return items.find((u) => u.username === handle)?.id ?? null
}

const setAvatarRoute = createRoute({
  operationId: 'setMyAvatar',
  summary: 'Set my avatar',
  tags: ['Users'],
  method: 'put',
  path: '/me/avatar',
  middleware: [requireAuth] as const,
  // Body is multipart/form-data (a `file` field); parsed directly in the handler
  // rather than via a request schema (the form validator conflicts with formData()).
  responses: {
    200: jsonContent(z.object({ url: z.string() }), 'Avatar URL'),
    400: errorResponse('Bad request'),
    413: errorResponse('File too large'),
    415: errorResponse('Expected multipart/form-data'),
    503: errorResponse('No public storage configured'),
  },
})

const deleteAvatarRoute = createRoute({
  operationId: 'deleteMyAvatar',
  summary: 'Remove my avatar',
  tags: ['Users'],
  method: 'delete',
  path: '/me/avatar',
  middleware: [requireAuth] as const,
  responses: { 200: jsonContent(z.object({ ok: z.literal(true) }), 'Removed') },
})

const listUsersRoute = createRoute({
  operationId: 'adminListUsers',
  summary: 'List users',
  tags: ['Users'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  request: {
    query: pageQuerySchema.extend({ search: z.string().optional() }),
  },
  responses: { 200: jsonContent(userListSchema, 'Users') },
})

const batchStatusRoute = createRoute({
  operationId: 'setUsersStatus',
  summary: 'Batch enable/disable users',
  tags: ['Users'],
  method: 'patch',
  path: '/',
  middleware: [requireAdmin] as const,
  request: jsonBody(batchPatchSchema),
  responses: {
    200: jsonContent(z.object({ updated: z.number().int(), ids: z.array(z.string()), status: z.string() }), 'Updated'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const batchDeleteRoute = createRoute({
  operationId: 'deleteUsers',
  summary: 'Batch delete users',
  tags: ['Users'],
  method: 'delete',
  path: '/',
  middleware: [requireAdmin] as const,
  request: jsonBody(userIdsSchema),
  responses: {
    200: jsonContent(z.object({ deleted: z.number().int(), ids: z.array(z.string()) }), 'Deleted'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const getUserRoute = createRoute({
  operationId: 'getUserProfile',
  summary: 'Get a user (admin) or public profile',
  tags: ['Users'],
  method: 'get',
  path: '/{username}',
  request: { params: z.object({ username: z.string() }) },
  responses: {
    200: jsonContent(userDetailSchema, 'User'),
    400: errorResponse('Bad request'),
    404: errorResponse('User not found'),
  },
})

const userObjectsRoute = createRoute({
  operationId: 'listUserObjects',
  summary: "List a user's public objects",
  tags: ['Users'],
  method: 'get',
  path: '/{username}/objects',
  request: { params: z.object({ username: z.string() }) },
  responses: {
    200: jsonContent(z.object({ items: z.array(z.unknown()), breadcrumb: z.array(z.unknown()) }), 'Objects'),
    404: errorResponse('User not found'),
  },
})

const setUserStatusRoute = createRoute({
  operationId: 'setUserStatus',
  summary: 'Set a user status',
  tags: ['Users'],
  method: 'patch',
  path: '/{username}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ username: z.string() }), ...jsonBody(updateStatusSchema) },
  responses: {
    200: jsonContent(z.object({ id: z.string(), status: z.string() }), 'Updated'),
    404: errorResponse('User not found'),
  },
})

const deleteUserRoute = createRoute({
  operationId: 'adminDeleteUser',
  summary: 'Delete a user',
  tags: ['Users'],
  method: 'delete',
  path: '/{username}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ username: z.string() }) },
  responses: {
    200: jsonContent(z.object({ id: z.string(), deleted: z.literal(true) }), 'Deleted'),
    404: errorResponse('User not found'),
  },
})

const listUserEntitlementsRoute = createRoute({
  operationId: 'listUserEntitlements',
  summary: 'List a user’s entitlements',
  tags: ['Users'],
  method: 'get',
  path: '/{username}/entitlements',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ username: z.string() }) },
  responses: {
    200: jsonContent(entitlementListSchema, 'Entitlements'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const grantUserEntitlementRoute = createRoute({
  operationId: 'grantUserEntitlement',
  summary: 'Grant a user entitlement',
  tags: ['Users'],
  method: 'post',
  path: '/{username}/entitlements',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ username: z.string() }), ...jsonBody(grantEntitlementSchema) },
  responses: {
    201: jsonContent(entitlementResultSchema, 'Granted'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const updateUserEntitlementRoute = createRoute({
  operationId: 'updateUserEntitlement',
  summary: 'Update a user entitlement',
  tags: ['Users'],
  method: 'patch',
  path: '/{username}/entitlements/{eid}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ username: z.string(), eid: z.string() }), ...jsonBody(updateEntitlementSchema) },
  responses: {
    200: jsonContent(entitlementResultSchema, 'Updated'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const revokeUserEntitlementRoute = createRoute({
  operationId: 'revokeUserEntitlement',
  summary: 'Revoke a user entitlement',
  tags: ['Users'],
  method: 'delete',
  path: '/{username}/entitlements/{eid}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ username: z.string(), eid: z.string() }) },
  responses: {
    200: jsonContent(entitlementResultSchema, 'Revoked'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

export const users = new OpenAPIHono<Env>()
  .openapi(setAvatarRoute, async (c) => {
    const form = await c.req.formData().catch(() => null)
    if (!form) return apiError(c, 415, 'Expected multipart/form-data with a file field')
    const file = form.get('file')
    if (!(file instanceof File)) return apiError(c, 400, 'file field is required')
    const result = await updateAvatar(c.get('deps'), {
      platform: c.get('platform'),
      userId: c.get('userId') as string,
      file,
    })
    if (!result.ok) return apiError(c, result.status, result.error)
    return c.json({ url: result.url }, 200)
  })
  .openapi(deleteAvatarRoute, async (c) => {
    await removeAvatar(c.get('deps'), { platform: c.get('platform'), userId: c.get('userId') as string })
    return c.json({ ok: true as const }, 200)
  })
  .openapi(listUsersRoute, async (c) => {
    const { page, pageSize, search } = c.req.valid('query')
    const result = await listUsers(c.get('deps'), { page, pageSize, search })
    return c.json({ items: result.items.map(toUserDTO), total: result.total, page, pageSize }, 200)
  })
  .openapi(batchStatusRoute, async (c) => {
    const body = c.req.valid('json')
    const result = await setUsersStatus(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      ids: body.ids,
      status: body.action === 'disable' ? 'disabled' : 'active',
    })
    if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
    return c.json({ ...result.result, status: result.status }, 200)
  })
  .openapi(batchDeleteRoute, async (c) => {
    const { ids } = c.req.valid('json')
    const result = await deleteUsers(c.get('deps'), { adminUserId: c.get('userId')!, orgId: c.get('orgId')!, ids })
    if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
    return c.json(result.result, 200)
  })
  .openapi(getUserRoute, async (c) => {
    const username = c.req.valid('param').username
    if (c.get('userRole') === 'admin') {
      const id = await resolveUserId(c.get('deps'), username)
      if (!id) return apiError(c, 404, 'User not found')
      const result = await getUser(c.get('deps'), id)
      if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
      return c.json(toUserDTO(result.user), 200)
    }
    const user = await getPublicProfile(c.get('deps'), username)
    if (!user) return apiError(c, 404, 'User not found')
    return c.json({ user, shares: [] }, 200)
  })
  .openapi(userObjectsRoute, async (c) => {
    const user = await getPublicProfile(c.get('deps'), c.req.valid('param').username)
    if (!user) return apiError(c, 404, 'User not found')
    return c.json({ items: [], breadcrumb: [] }, 200)
  })
  .openapi(setUserStatusRoute, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.valid('param').username)
    if (!id) return apiError(c, 404, 'User not found')
    const { status } = c.req.valid('json')
    const result = await setUserStatus(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      userId: id,
      status,
    })
    if (!result.ok) return apiError(c, 404, 'User not found')
    return c.json({ id, status }, 200)
  })
  .openapi(deleteUserRoute, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.valid('param').username)
    if (!id) return apiError(c, 404, 'User not found')
    const result = await deleteUser(c.get('deps'), {
      adminUserId: c.get('userId')!,
      orgId: c.get('orgId')!,
      userId: id,
    })
    if (!result.ok) return apiError(c, 404, 'User not found')
    return c.json({ id, deleted: true as const }, 200)
  })
  .openapi(listUserEntitlementsRoute, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.valid('param').username)
    if (!id) return apiError(c, 404, 'User not found')
    const result = await listUserEntitlements(c.get('deps'), id)
    if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
    const items = result.result.items.map(toQuotaEntitlementDTO)
    return c.json({ items, total: items.length, page: 1, pageSize: items.length }, 200)
  })
  .openapi(grantUserEntitlementRoute, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.valid('param').username)
    if (!id) return apiError(c, 404, 'User not found')
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
    if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
    return c.json(toEntitlementResultDTO(result.result), 201)
  })
  .openapi(updateUserEntitlementRoute, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.valid('param').username)
    if (!id) return apiError(c, 404, 'User not found')
    const body = c.req.valid('json')
    const result = await updateUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: id,
      entitlementId: c.req.valid('param').eid,
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
    return c.json(toEntitlementResultDTO(result.result), 200)
  })
  .openapi(revokeUserEntitlementRoute, async (c) => {
    const id = await resolveUserId(c.get('deps'), c.req.valid('param').username)
    if (!id) return apiError(c, 404, 'User not found')
    const result = await revokeUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetUserId: id,
      entitlementId: c.req.valid('param').eid,
    })
    if (!result.ok) return apiError(c, result.failure.status, result.failure.error)
    return c.json(toEntitlementResultDTO(result.result), 200)
  })
