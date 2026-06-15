import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
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

const createLinkSchema = z.object({
  role: z.enum(['editor', 'viewer']).default('viewer'),
  expiresIn: z.number().int().min(1).optional(), // milliseconds
})

const joinSchema = z.object({
  token: z.string().min(1),
})

const activityQuerySchema = z.object({
  page: z.string().optional(),
  pageSize: z.string().optional(),
})

export const publicTeams = new Hono<Env>().get('/invite-links/:token', async (c) => {
  const info = await getInviteLinkInfo(c.get('deps'), c.req.param('token'))
  if (!info) return c.json({ error: 'Invalid or expired invite link' }, 404)
  return c.json(info)
})

export const teams = new Hono<Env>()
  .use(requireAuth)
  .post('/:teamId/invite-links', zValidator('json', createLinkSchema), async (c) => {
    const { role, expiresIn } = c.req.valid('json')
    const result = await createInviteLink(c.get('deps'), {
      teamId: c.req.param('teamId'),
      userId: c.get('userId')!,
      role,
      expiresIn,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ token: result.token, expiresAt: result.expiresAt }, 201)
  })
  .get('/:teamId/invitations', async (c) => {
    const result = await listInvitations(c.get('deps'), {
      teamId: c.req.param('teamId'),
      userId: c.get('userId')!,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ invitations: result.invitations })
  })
  .post('/:teamId/members', zValidator('json', joinSchema), async (c) => {
    const result = await joinTeam(c.get('deps'), {
      teamId: c.req.param('teamId'),
      userId: c.get('userId')!,
      token: c.req.valid('json').token,
    })
    if (result.ok) return c.json({ ok: true })
    if (result.reason === 'invalid') return c.json({ error: 'Invalid invite link' }, 404)
    if (result.reason === 'expired') return c.json({ error: 'Invite link has expired' }, 410)
    return c.json({ error: 'Already a member of this team' }, 409)
  })
  .get('/:teamId/activity', zValidator('query', activityQuerySchema), async (c) => {
    const { page: pageStr, pageSize: pageSizeStr } = c.req.valid('query')
    const page = Number(pageStr ?? '1')
    const pageSize = Number(pageSizeStr ?? '20')
    const result = await listActivity(c.get('deps'), {
      teamId: c.req.param('teamId'),
      userId: c.get('userId')!,
      page,
      pageSize,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ ...result.result, page, pageSize })
  })
  // ── Org logo (public-bucket image) ───────────────────────────────────────────
  .put('/:teamId/logo', async (c) => {
    const { teamId } = c.req.param()
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
    if (result.ok) return c.json({ url: result.url })
    if (result.reason === 'forbidden') return c.json({ error: 'Forbidden' }, 403)
    return c.json({ error: result.error }, result.status)
  })
  .delete('/:teamId/logo', async (c) => {
    const result = await deleteTeamLogo(c.get('deps'), {
      platform: c.get('platform'),
      teamId: c.req.param('teamId'),
      userId: c.get('userId') as string,
    })
    if (!result.ok) return c.json({ error: 'Forbidden' }, 403)
    return c.json({ ok: true })
  })

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

// Admin team management. Lists team orgs, exposes one team's detail, and manages
// that team's quota entitlements. The CRUD handlers are org-generic (org-entitlements
// service) but live here since the team admin UI is their only consumer.
export const adminTeams = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => c.json(await listTeams(c.get('deps'))))
  .get('/:teamId', async (c) => {
    const team = await getTeam(c.get('deps'), c.req.param('teamId'))
    if (!team) return c.json({ error: 'Team not found' }, 404)
    return c.json(team)
  })
  .get('/:teamId/entitlements', async (c) => {
    const result = await listTeamEntitlements(c.get('deps'), c.req.param('teamId'))
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .post('/:teamId/entitlements', zValidator('json', grantEntitlementSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await grantTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.param('teamId'),
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result, 201)
  })
  .patch('/:teamId/entitlements/:eid', zValidator('json', updateEntitlementSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await updateTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.param('teamId'),
      entitlementId: c.req.param('eid'),
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .delete('/:teamId/entitlements/:eid', async (c) => {
    const result = await revokeTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.param('teamId'),
      entitlementId: c.req.param('eid'),
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
