import { z } from '@hono/zod-openapi'
import { AuthorizationScope } from '@shared/authorization'
import { cursorPageQuerySchema, cursorPageSchema, opaqueIdSchema, opaqueTokenSchema } from '@shared/schemas'
import { notFound, unauthorized } from '../../usecases/ports'
import {
  createSiteInvitation,
  getSiteInvitationByToken,
  listSiteInvitations,
  resendSiteInvitation,
  revokeSiteInvitation,
} from '../../usecases/site/invitation'
import { authRoute, errorResponse, jsonBody, jsonContent } from '../openapi'
import {
  createdAtIdCursorCodec,
  decodeOptionalPageToken,
  encodeNextPageToken,
  pageQueryFingerprint,
} from '../page-token'
import { createRouter } from '../router'

// SiteInvitation is already wire-shaped (ISO string timestamps) — no DTO mapper.
const siteInvitationSchema = z
  .object({
    id: opaqueIdSchema,
    email: z.string(),
    token: opaqueTokenSchema,
    invitedBy: opaqueIdSchema,
    invitedByName: z.string(),
    acceptedBy: opaqueIdSchema.nullable(),
    acceptedAt: z.string().nullable(),
    revokedBy: opaqueIdSchema.nullable(),
    revokedAt: z.string().nullable(),
    expiresAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.string(),
  })
  .openapi('SiteInvitation')

const siteInvitationListSchema = cursorPageSchema(siteInvitationSchema, 'SiteInvitationList')

const createSchema = z.object({ email: z.string().email() })

const listRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_INVITATIONS_READ], siteRole: 'admin' },
  {
    operationId: 'listSiteInvitations',
    summary: 'List site invitations',
    tags: ['Invitations'],
    method: 'get',
    path: '/',
    request: { query: cursorPageQuerySchema },
    responses: {
      200: jsonContent(siteInvitationListSchema, 'Invitations'),
      400: errorResponse('Invalid page token'),
    },
  },
)

const createRouteDoc = authRoute(
  { scopes: [AuthorizationScope.SITE_INVITATIONS_CREATE], siteRole: 'admin' },
  {
    operationId: 'createSiteInvitation',
    summary: 'Create site invitation',
    tags: ['Invitations'],
    method: 'post',
    path: '/',
    request: jsonBody(createSchema),
    responses: {
      201: jsonContent(siteInvitationSchema, 'Created invitation'),
      400: errorResponse('Email delivery is not configured'),
      401: errorResponse('Unauthorized'),
      409: errorResponse('Invitation conflict'),
      502: errorResponse('The invitation email could not be sent; no invitation is kept'),
    },
  },
)

const resendRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_INVITATIONS_CREATE], siteRole: 'admin' },
  {
    operationId: 'resendSiteInvitation',
    summary: 'Resend a site invitation',
    tags: ['Invitations'],
    method: 'post',
    path: '/{id}/deliveries',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      200: jsonContent(siteInvitationSchema, 'Resent invitation'),
      400: errorResponse('Invitation is no longer pending, or email delivery is not configured'),
      404: errorResponse('Invitation not found'),
      502: errorResponse('The invitation email could not be sent'),
    },
  },
)

const revokeRoute = authRoute(
  { scopes: [AuthorizationScope.SITE_INVITATIONS_DELETE], siteRole: 'admin' },
  {
    operationId: 'revokeSiteInvitation',
    summary: 'Revoke a site invitation',
    tags: ['Invitations'],
    method: 'delete',
    path: '/{id}',
    request: { params: z.object({ id: opaqueIdSchema }) },
    responses: {
      204: { description: 'Revoked invitation' },
      400: errorResponse('Invitation is no longer pending'),
      401: errorResponse('Unauthorized'),
      404: errorResponse('Invitation not found'),
    },
  },
)

const getByTokenRoute = authRoute(
  { public: true },
  {
    operationId: 'getSiteInvitation',
    summary: 'Get a site invitation by token',
    tags: ['Invitations'],
    method: 'get',
    path: '/{token}',
    request: { params: z.object({ token: opaqueTokenSchema }) },
    responses: {
      200: jsonContent(siteInvitationSchema, 'Invitation'),
      404: errorResponse('Invitation not found'),
    },
  },
)

export const adminSiteInvitations = createRouter()
  .openapi(listRoute, async (c) => {
    const { pageSize, pageToken } = c.req.valid('query')
    const page = {
      query: await pageQueryFingerprint({ resource: 'site-invitations', pageSize }),
      codec: createdAtIdCursorCodec,
    }
    const after = await decodeOptionalPageToken(c.get('platform'), pageToken, page)
    const result = await listSiteInvitations(c.get('deps'), { pageSize, after })
    return c.json(
      {
        items: result.items,
        nextPageToken: await encodeNextPageToken(c.get('platform'), result.nextBoundary, page),
      },
      200,
    )
  })
  .openapi(createRouteDoc, async (c) => {
    const userId = c.get('userId')
    if (!userId) throw unauthorized()
    const result = await createSiteInvitation(c.get('deps'), c.get('platform'), {
      userId,
      email: c.req.valid('json').email,
      requestUrl: c.req.url,
    })
    if (!result.ok) throw result.error
    return c.json(result.invitation, 201)
  })
  .openapi(resendRoute, async (c) => {
    const result = await resendSiteInvitation(c.get('deps'), c.get('platform'), {
      id: c.req.valid('param').id,
      requestUrl: c.req.url,
    })
    if (!result.ok) throw result.error
    return c.json(result.invitation, 200)
  })
  .openapi(revokeRoute, async (c) => {
    const userId = c.get('userId')
    if (!userId) throw unauthorized()
    const id = c.req.valid('param').id
    const result = await revokeSiteInvitation(c.get('deps'), { userId, id })
    if (!result.ok) throw result.error
    return c.body(null, 204)
  })

export const publicSiteInvitations = createRouter().openapi(getByTokenRoute, async (c) => {
  const invitation = await getSiteInvitationByToken(c.get('deps'), c.req.valid('param').token)
  if (!invitation) throw notFound('Invitation not found')
  return c.json(invitation, 200)
})
