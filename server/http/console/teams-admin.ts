import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import {
  getTeam,
  grantTeamEntitlement,
  listTeamEntitlements,
  listTeams,
  revokeTeamEntitlement,
  updateTeamEntitlement,
} from '../../usecases/team'

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

// Admin team management — sibling to /api/admin/users. Lists team orgs, exposes
// one team's detail, and manages that team's quota entitlements. The CRUD
// handlers are org-generic (org-entitlements service) but live here since the
// team admin UI is their only consumer.
export const adminTeams = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => c.json(await listTeams(c.get('deps'))))
  .get('/:orgId', async (c) => {
    const team = await getTeam(c.get('deps'), c.req.param('orgId'))
    if (!team) return c.json({ error: 'Team not found' }, 404)
    return c.json(team)
  })
  .get('/:orgId/entitlements', async (c) => {
    const result = await listTeamEntitlements(c.get('deps'), c.req.param('orgId'))
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .post('/:orgId/entitlements', zValidator('json', grantEntitlementSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await grantTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.param('orgId'),
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result, 201)
  })
  .patch('/:orgId/entitlements/:eid', zValidator('json', updateEntitlementSchema), async (c) => {
    const body = c.req.valid('json')
    const result = await updateTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.param('orgId'),
      entitlementId: c.req.param('eid'),
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
  .delete('/:orgId/entitlements/:eid', async (c) => {
    const result = await revokeTeamEntitlement(c.get('deps'), {
      adminUserId: c.get('userId')!,
      adminOrgId: c.get('orgId')!,
      targetOrgId: c.req.param('orgId'),
      entitlementId: c.req.param('eid'),
    })
    if (!result.ok) return c.json({ error: result.failure.error }, result.failure.status)
    return c.json(result.result)
  })
