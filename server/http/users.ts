import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import {
  badRequest,
  forbidden,
  internalError,
  noStorage,
  notFound,
  payloadTooLarge,
  unsupportedMediaType,
} from '../usecases/ports'
import { getUserQuota } from '../usecases/quota'
import {
  getPublicProfile,
  grantUserEntitlement,
  listUserEntitlements,
  removeAvatar,
  revokeUserEntitlement,
  updateAvatar,
  updateUserEntitlement,
} from '../usecases/user'
import {
  entitlementListSchema,
  entitlementResultSchema,
  toEntitlementResultDTO,
  toQuotaEntitlementDTO,
} from './entitlements'
import { errorResponse, jsonBody, jsonContent } from './openapi'

// Admin user management (list / disable / delete) is served directly by
// better-auth's /api/auth/admin/* endpoints and called from the frontend admin
// client. This resource only covers front-of-house concerns — the public profile
// lookup, the authenticated user's own avatar — plus the admin storage
// entitlement grants, which live in our own quota domain rather than better-auth.

const publicUserSchema = z
  .object({ username: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi('PublicUser')

const publicProfileSchema = z.object({ user: publicUserSchema, shares: z.array(z.unknown()) }).openapi('PublicProfile')

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

// Maps a UserOperationFailure ({ error, status }) threaded from the UserAdminRepo
// to the matching error factory — keeping the sub-usecase status out of the http
// boundary's own logic.
function failureError(failure: { status: 400 | 404; error: string }) {
  return failure.status === 404 ? notFound(failure.error) : badRequest(failure.error)
}

// Maps the image-upload gateway outcome ({ status, error }) to its error factory.
function imageUploadError(status: 400 | 403 | 413 | 500 | 503, error: string) {
  if (status === 413) return payloadTooLarge(error)
  if (status === 503) return noStorage(error)
  if (status === 403) return forbidden(error)
  if (status === 500) return internalError(error)
  return badRequest(error)
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
  responses: { 204: { description: 'Removed' } },
})

const getUserRoute = createRoute({
  operationId: 'getUserProfile',
  summary: 'Get a user public profile',
  tags: ['Users'],
  method: 'get',
  path: '/{username}',
  request: { params: z.object({ username: z.string() }) },
  responses: {
    200: jsonContent(publicProfileSchema, 'User'),
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

// Per-user storage used/total — a user sub-resource the admin UI fans out over
// (one request per visible user) to enrich better-auth's admin list, which knows
// identity but not quota. `hasPersonalOrg` is false when the user has no personal
// org yet (used/total are then 0).
const userQuotaSchema = z
  .object({ used: z.number().int(), total: z.number().int(), hasPersonalOrg: z.boolean() })
  .openapi('AdminUserQuota')

const getUserQuotaRoute = createRoute({
  operationId: 'getUserQuota',
  summary: "Get a user's storage quota",
  tags: ['Users'],
  method: 'get',
  path: '/{userId}/quota',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ userId: z.string() }) },
  responses: { 200: jsonContent(userQuotaSchema, 'User quota') },
})

const listUserEntitlementsRoute = createRoute({
  operationId: 'listUserEntitlements',
  summary: 'List a user’s entitlements',
  tags: ['Users'],
  method: 'get',
  path: '/{userId}/entitlements',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ userId: z.string() }) },
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
  path: '/{userId}/entitlements',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ userId: z.string() }), ...jsonBody(grantEntitlementSchema) },
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
  path: '/{userId}/entitlements/{eid}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ userId: z.string(), eid: z.string() }), ...jsonBody(updateEntitlementSchema) },
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
  path: '/{userId}/entitlements/{eid}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ userId: z.string(), eid: z.string() }) },
  responses: {
    204: { description: 'Revoked' },
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

export const users = new OpenAPIHono<Env>()
  .openapi(setAvatarRoute, async (c) => {
    const form = await c.req.formData().catch(() => null)
    if (!form) throw unsupportedMediaType('Expected multipart/form-data with a file field')
    const file = form.get('file')
    if (!(file instanceof File)) throw badRequest('file field is required')
    const result = await updateAvatar(c.get('deps'), {
      platform: c.get('platform'),
      userId: c.get('userId') as string,
      file,
    })
    if (!result.ok) throw imageUploadError(result.status, result.error)
    return c.json({ url: result.url }, 200)
  })
  .openapi(deleteAvatarRoute, async (c) => {
    await removeAvatar(c.get('deps'), { platform: c.get('platform'), userId: c.get('userId') as string })
    return c.body(null, 204)
  })
  .openapi(getUserRoute, async (c) => {
    const user = await getPublicProfile(c.get('deps'), c.req.valid('param').username)
    if (!user) throw notFound('User not found')
    return c.json({ user, shares: [] }, 200)
  })
  .openapi(userObjectsRoute, async (c) => {
    const user = await getPublicProfile(c.get('deps'), c.req.valid('param').username)
    if (!user) throw notFound('User not found')
    return c.json({ items: [], breadcrumb: [] }, 200)
  })
  .openapi(getUserQuotaRoute, async (c) => {
    const quota = await getUserQuota(c.get('deps'), { userId: c.req.valid('param').userId })
    if (!quota) return c.json({ used: 0, total: 0, hasPersonalOrg: false }, 200)
    return c.json({ used: quota.used, total: quota.quota, hasPersonalOrg: true }, 200)
  })
  .openapi(listUserEntitlementsRoute, async (c) => {
    const result = await listUserEntitlements(c.get('deps'), c.req.valid('param').userId)
    if (!result.ok) throw failureError(result.failure)
    const items = result.result.items.map(toQuotaEntitlementDTO)
    return c.json({ items, total: items.length, page: 1, pageSize: items.length }, 200)
  })
  .openapi(grantUserEntitlementRoute, async (c) => {
    const body = c.req.valid('json')
    const result = await grantUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      targetUserId: c.req.valid('param').userId,
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if (!result.ok) throw failureError(result.failure)
    return c.json(toEntitlementResultDTO(result.result), 201)
  })
  .openapi(updateUserEntitlementRoute, async (c) => {
    const body = c.req.valid('json')
    const result = await updateUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      targetUserId: c.req.valid('param').userId,
      entitlementId: c.req.valid('param').eid,
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) throw failureError(result.failure)
    return c.json(toEntitlementResultDTO(result.result), 200)
  })
  .openapi(revokeUserEntitlementRoute, async (c) => {
    const result = await revokeUserEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      targetUserId: c.req.valid('param').userId,
      entitlementId: c.req.valid('param').eid,
    })
    if (!result.ok) throw failureError(result.failure)
    return c.body(null, 204)
  })
