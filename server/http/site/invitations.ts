import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { pageQuerySchema, pageSchema } from '@shared/schemas'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { notFound, unauthorized } from '../../usecases/ports'
import {
  createSiteInvitation,
  getSiteInvitationByToken,
  listSiteInvitations,
  resendSiteInvitation,
  revokeSiteInvitation,
} from '../../usecases/site/invitation'
import { errorResponse, jsonBody, jsonContent } from '../openapi'

// SiteInvitation is already wire-shaped (ISO string timestamps) — no DTO mapper.
const siteInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    token: z.string(),
    invitedBy: z.string(),
    invitedByName: z.string(),
    acceptedBy: z.string().nullable(),
    acceptedAt: z.string().nullable(),
    revokedBy: z.string().nullable(),
    revokedAt: z.string().nullable(),
    expiresAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    status: z.string(),
  })
  .openapi('SiteInvitation')

const siteInvitationListSchema = pageSchema(siteInvitationSchema, 'SiteInvitationList')

const createSchema = z.object({ email: z.string().email() })

const listRoute = createRoute({
  operationId: 'listSiteInvitations',
  summary: 'List site invitations',
  tags: ['Invitations'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  request: { query: pageQuerySchema },
  responses: { 200: jsonContent(siteInvitationListSchema, 'Invitations') },
})

const createRouteDoc = createRoute({
  operationId: 'createSiteInvitation',
  summary: 'Create site invitation',
  tags: ['Invitations'],
  method: 'post',
  path: '/',
  middleware: [requireAdmin] as const,
  request: jsonBody(createSchema),
  responses: {
    201: jsonContent(siteInvitationSchema, 'Created invitation'),
    401: errorResponse('Unauthorized'),
    409: errorResponse('Invitation conflict'),
  },
})

const resendRoute = createRoute({
  operationId: 'resendSiteInvitation',
  summary: 'Resend a site invitation',
  tags: ['Invitations'],
  method: 'post',
  path: '/{id}/deliveries',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(siteInvitationSchema, 'Resent invitation'),
    400: errorResponse('Invitation is no longer pending'),
    404: errorResponse('Invitation not found'),
  },
})

const revokeRoute = createRoute({
  operationId: 'revokeSiteInvitation',
  summary: 'Revoke a site invitation',
  tags: ['Invitations'],
  method: 'delete',
  path: '/{id}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: jsonContent(z.object({ id: z.string(), revoked: z.literal(true) }), 'Revoked invitation'),
    400: errorResponse('Invitation is no longer pending'),
    401: errorResponse('Unauthorized'),
    404: errorResponse('Invitation not found'),
  },
})

const getByTokenRoute = createRoute({
  operationId: 'getSiteInvitation',
  summary: 'Get a site invitation by token',
  tags: ['Invitations'],
  method: 'get',
  path: '/{token}',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonContent(siteInvitationSchema, 'Invitation'),
    404: errorResponse('Invitation not found'),
  },
})

export const adminSiteInvitations = new OpenAPIHono<Env>()
  .openapi(listRoute, async (c) => {
    const { page, pageSize } = c.req.valid('query')
    const result = await listSiteInvitations(c.get('deps'), page, pageSize)
    return c.json({ ...result, page, pageSize }, 200)
  })
  .openapi(createRouteDoc, async (c) => {
    const userId = c.get('userId')
    if (!userId) throw unauthorized()
    const result = await createSiteInvitation(c.get('deps'), c.get('platform'), {
      userId,
      orgId: c.get('orgId')!,
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
    const result = await revokeSiteInvitation(c.get('deps'), { userId, orgId: c.get('orgId')!, id })
    if (!result.ok) throw result.error
    return c.json({ id, revoked: true as const }, 200)
  })

export const publicSiteInvitations = new OpenAPIHono<Env>().openapi(getByTokenRoute, async (c) => {
  const invitation = await getSiteInvitationByToken(c.get('deps'), c.req.valid('param').token)
  if (!invitation) throw notFound('Invitation not found')
  return c.json(invitation, 200)
})
