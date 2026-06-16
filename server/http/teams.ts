import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import type { ActivityEventWithUser, InviteLinkInfo, PendingInvitation } from '../usecases/ports'
import {
  createInviteLink,
  deleteTeamLogo,
  getInviteLinkInfo,
  getTeam,
  grantTeamEntitlement,
  joinTeam,
  listActivity,
  listInvitations,
  listTeamEntitlements,
  listTeams,
  revokeTeamEntitlement,
  setTeamLogo,
  updateTeamEntitlement,
} from '../usecases/team'
import {
  entitlementListSchema,
  entitlementResultSchema,
  toEntitlementResultDTO,
  toQuotaEntitlementDTO,
} from './entitlements'
import { errorResponse, jsonBody, jsonContent } from './openapi'

const inviteLinkInfoSchema = z
  .object({
    organizationId: z.string(),
    organizationName: z.string(),
    role: z.string(),
    expiresAt: z.string().nullable(),
  })
  .openapi('TeamInviteLinkInfo')

function toInviteLinkInfoDTO(i: InviteLinkInfo): z.infer<typeof inviteLinkInfoSchema> {
  return { ...i, expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null }
}

const inviteLinkCreatedSchema = z.object({ token: z.string(), expiresAt: z.string() }).openapi('TeamInviteLinkCreated')

const pendingInvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: z.string(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('PendingInvitation')

function toPendingInvitationDTO(p: PendingInvitation): z.infer<typeof pendingInvitationSchema> {
  return { ...p, expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null, createdAt: p.createdAt.toISOString() }
}

const activityEventSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    userId: z.string(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string().nullable(),
    targetName: z.string(),
    metadata: z.string().nullable(),
    createdAt: z.string(),
    user: z.object({ id: z.string(), name: z.string(), image: z.string().nullable() }),
  })
  .openapi('ActivityEvent')

function toActivityEventDTO(e: ActivityEventWithUser): z.infer<typeof activityEventSchema> {
  return { ...e, createdAt: e.createdAt.toISOString() }
}

const activityPageSchema = z
  .object({
    items: z.array(activityEventSchema),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi('ActivityPage')

const teamSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    logo: z.string().nullable(),
    memberCount: z.number().int(),
    ownerName: z.string().nullable(),
    quotaUsed: z.number().int(),
    quotaTotal: z.number().int(),
    createdAt: z.number().int(),
  })
  .openapi('TeamSummary')

const teamListSchema = z.object({ items: z.array(teamSummarySchema), total: z.number().int() }).openapi('TeamList')

const createLinkSchema = z.object({
  role: z.enum(['editor', 'viewer']).default('viewer'),
  expiresIn: z.number().int().min(1).optional(),
})

const joinSchema = z.object({ token: z.string().min(1) })

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

// ── publicTeams ──────────────────────────────────────────────────────────────
const inviteLinkInfoRoute = createRoute({
  operationId: 'getTeamInviteLink',
  summary: 'Get team invite link info',
  tags: ['Teams'],
  method: 'get',
  path: '/invite-links/{token}',
  request: { params: z.object({ token: z.string() }) },
  responses: {
    200: jsonContent(inviteLinkInfoSchema, 'Invite link info'),
    404: errorResponse('Invalid or expired invite link'),
  },
})

export const publicTeams = new OpenAPIHono<Env>().openapi(inviteLinkInfoRoute, async (c) => {
  const info = await getInviteLinkInfo(c.get('deps'), c.req.valid('param').token)
  if (!info) return c.json({ error: 'Invalid or expired invite link' }, 404)
  return c.json(toInviteLinkInfoDTO(info), 200)
})

// ── teams (member-scoped) ────────────────────────────────────────────────────
const createInviteLinkRoute = createRoute({
  operationId: 'createTeamInviteLink',
  summary: 'Create a team invite link',
  tags: ['Teams'],
  method: 'post',
  path: '/{teamId}/invite-links',
  request: { params: z.object({ teamId: z.string() }), ...jsonBody(createLinkSchema) },
  responses: {
    201: jsonContent(inviteLinkCreatedSchema, 'Created invite link'),
    403: errorResponse('Forbidden'),
  },
})

const listInvitationsRoute = createRoute({
  operationId: 'listTeamInvitations',
  summary: 'List pending team invitations',
  tags: ['Teams'],
  method: 'get',
  path: '/{teamId}/invitations',
  request: { params: z.object({ teamId: z.string() }) },
  responses: {
    200: jsonContent(z.object({ invitations: z.array(pendingInvitationSchema) }), 'Pending invitations'),
    403: errorResponse('Forbidden'),
  },
})

const joinTeamRoute = createRoute({
  operationId: 'joinTeam',
  summary: 'Join a team with an invite token',
  tags: ['Teams'],
  method: 'post',
  path: '/{teamId}/members',
  request: { params: z.object({ teamId: z.string() }), ...jsonBody(joinSchema) },
  responses: {
    200: jsonContent(z.object({ ok: z.literal(true) }), 'Joined'),
    404: errorResponse('Invalid invite link'),
    409: errorResponse('Already a member'),
    410: errorResponse('Invite link expired'),
  },
})

const activityRoute = createRoute({
  operationId: 'listTeamActivity',
  summary: 'List team activity',
  tags: ['Teams'],
  method: 'get',
  path: '/{teamId}/activity',
  request: {
    params: z.object({ teamId: z.string() }),
    query: z.object({ page: z.string().optional(), pageSize: z.string().optional() }),
  },
  responses: {
    200: jsonContent(activityPageSchema, 'Activity'),
    403: errorResponse('Forbidden'),
  },
})

const setLogoRoute = createRoute({
  operationId: 'setTeamLogo',
  summary: 'Set team logo',
  tags: ['Teams'],
  method: 'put',
  path: '/{teamId}/logo',
  // Body is multipart/form-data (a `file` field); parsed directly in the handler
  // rather than via a request schema (the form validator conflicts with formData()).
  request: { params: z.object({ teamId: z.string() }) },
  responses: {
    200: jsonContent(z.object({ url: z.string() }), 'Logo URL'),
    400: errorResponse('Bad request'),
    403: errorResponse('Forbidden'),
    413: errorResponse('File too large'),
    415: errorResponse('Expected multipart/form-data'),
    503: errorResponse('No public storage configured'),
  },
})

const deleteLogoRoute = createRoute({
  operationId: 'deleteTeamLogo',
  summary: 'Delete team logo',
  tags: ['Teams'],
  method: 'delete',
  path: '/{teamId}/logo',
  request: { params: z.object({ teamId: z.string() }) },
  responses: {
    200: jsonContent(z.object({ ok: z.literal(true) }), 'Deleted'),
    403: errorResponse('Forbidden'),
  },
})

const teamsApp = new OpenAPIHono<Env>()
teamsApp.use(requireAuth)

export const teams = teamsApp
  .openapi(createInviteLinkRoute, async (c) => {
    const { role, expiresIn } = c.req.valid('json')
    const result = await createInviteLink(c.get('deps'), {
      teamId: c.req.valid('param').teamId,
      userId: c.get('userId')!,
      role,
      expiresIn,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ token: result.token, expiresAt: result.expiresAt.toISOString() }, 201)
  })
  .openapi(listInvitationsRoute, async (c) => {
    const result = await listInvitations(c.get('deps'), {
      teamId: c.req.valid('param').teamId,
      userId: c.get('userId')!,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ invitations: result.invitations.map(toPendingInvitationDTO) }, 200)
  })
  .openapi(joinTeamRoute, async (c) => {
    const result = await joinTeam(c.get('deps'), {
      teamId: c.req.valid('param').teamId,
      userId: c.get('userId')!,
      token: c.req.valid('json').token,
    })
    if (result.ok) return c.json({ ok: true as const }, 200)
    if (result.reason === 'invalid') return c.json({ error: 'Invalid invite link' }, 404)
    if (result.reason === 'expired') return c.json({ error: 'Invite link has expired' }, 410)
    return c.json({ error: 'Already a member of this team' }, 409)
  })
  .openapi(activityRoute, async (c) => {
    const { page: pageStr, pageSize: pageSizeStr } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const result = await listActivity(c.get('deps'), {
      teamId: c.req.valid('param').teamId,
      userId: c.get('userId')!,
      page,
      pageSize,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json(
      { items: result.result.items.map(toActivityEventDTO), total: result.result.total, page, pageSize },
      200,
    )
  })
  .openapi(setLogoRoute, async (c) => {
    const teamId = c.req.valid('param').teamId
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'Expected multipart/form-data with a file field' }, 415)
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)

    const result = await setTeamLogo(c.get('deps'), {
      platform: c.get('platform'),
      teamId,
      userId: c.get('userId') as string,
      file,
    })
    if (result.ok) return c.json({ url: result.url }, 200)
    if (result.reason === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
    return c.json({ error: result.error }, result.status)
  })
  .openapi(deleteLogoRoute, async (c) => {
    const result = await deleteTeamLogo(c.get('deps'), {
      platform: c.get('platform'),
      teamId: c.req.valid('param').teamId,
      userId: c.get('userId') as string,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ ok: true as const }, 200)
  })

// ── adminTeams ───────────────────────────────────────────────────────────────
const listTeamsRoute = createRoute({
  operationId: 'listTeams',
  summary: 'List teams',
  tags: ['Teams'],
  method: 'get',
  path: '/',
  middleware: [requireAdmin] as const,
  responses: { 200: jsonContent(teamListSchema, 'Teams') },
})

const getTeamRoute = createRoute({
  operationId: 'getTeam',
  summary: 'Get a team',
  tags: ['Teams'],
  method: 'get',
  path: '/{teamId}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ teamId: z.string() }) },
  responses: {
    200: jsonContent(teamSummarySchema, 'Team'),
    404: errorResponse('Team not found'),
  },
})

const listEntitlementsRoute = createRoute({
  operationId: 'listTeamEntitlements',
  summary: 'List team quota entitlements',
  tags: ['Teams'],
  method: 'get',
  path: '/{teamId}/entitlements',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ teamId: z.string() }) },
  responses: {
    200: jsonContent(entitlementListSchema, 'Entitlements'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const grantEntitlementRoute = createRoute({
  operationId: 'grantTeamEntitlement',
  summary: 'Grant a team entitlement',
  tags: ['Teams'],
  method: 'post',
  path: '/{teamId}/entitlements',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ teamId: z.string() }), ...jsonBody(grantEntitlementSchema) },
  responses: {
    201: jsonContent(entitlementResultSchema, 'Granted entitlement'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const updateEntitlementRoute = createRoute({
  operationId: 'updateTeamEntitlement',
  summary: 'Update a team entitlement',
  tags: ['Teams'],
  method: 'patch',
  path: '/{teamId}/entitlements/{eid}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ teamId: z.string(), eid: z.string() }), ...jsonBody(updateEntitlementSchema) },
  responses: {
    200: jsonContent(entitlementResultSchema, 'Updated entitlement'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

const revokeEntitlementRoute = createRoute({
  operationId: 'revokeTeamEntitlement',
  summary: 'Revoke a team entitlement',
  tags: ['Teams'],
  method: 'delete',
  path: '/{teamId}/entitlements/{eid}',
  middleware: [requireAdmin] as const,
  request: { params: z.object({ teamId: z.string(), eid: z.string() }) },
  responses: {
    200: jsonContent(entitlementResultSchema, 'Revoked entitlement'),
    400: errorResponse('Bad request'),
    404: errorResponse('Not found'),
  },
})

export const adminTeams = new OpenAPIHono<Env>()
  .openapi(listTeamsRoute, async (c) => c.json(await listTeams(c.get('deps')), 200))
  .openapi(getTeamRoute, async (c) => {
    const team = await getTeam(c.get('deps'), c.req.valid('param').teamId)
    if (!team) return c.json({ error: 'Team not found' }, 404)
    return c.json(team, 200)
  })
  .openapi(listEntitlementsRoute, async (c) => {
    const result = await listTeamEntitlements(c.get('deps'), c.req.valid('param').teamId)
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json({ orgId: result.result.orgId, items: result.result.items.map(toQuotaEntitlementDTO) }, 200)
  })
  .openapi(grantEntitlementRoute, async (c) => {
    const body = c.req.valid('json')
    const result = await grantTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.valid('param').teamId,
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(toEntitlementResultDTO(result.result), 201)
  })
  .openapi(updateEntitlementRoute, async (c) => {
    const body = c.req.valid('json')
    const result = await updateTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.valid('param').teamId,
      entitlementId: c.req.valid('param').eid,
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(toEntitlementResultDTO(result.result), 200)
  })
  .openapi(revokeEntitlementRoute, async (c) => {
    const result = await revokeTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.valid('param').teamId,
      entitlementId: c.req.valid('param').eid,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(toEntitlementResultDTO(result.result), 200)
  })
