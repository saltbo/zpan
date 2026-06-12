import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import {
  grantOrgEntitlement,
  listOrgEntitlements,
  revokeOrgEntitlement,
  updateOrgEntitlement,
} from '../services/org-entitlements'
import { getTeam, listTeams } from '../services/team'

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
  .get('/', async (c) => {
    const items = await listTeams(c.get('platform').db)
    return c.json({ items, total: items.length })
  })
  .get('/:orgId', async (c) => {
    const team = await getTeam(c.get('platform').db, c.req.param('orgId'))
    if (!team) return c.json({ error: 'Team not found' }, 404)
    return c.json(team)
  })
  .get('/:orgId/entitlements', async (c) => {
    const result = await listOrgEntitlements(c.get('platform').db, c.req.param('orgId'))
    if ('error' in result) return c.json({ error: result.error }, result.status)
    return c.json(result)
  })
  .post('/:orgId/entitlements', zValidator('json', grantEntitlementSchema), async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const adminOrgId = c.get('orgId')!
    const targetOrgId = c.req.param('orgId')
    const body = c.req.valid('json')
    const result = await grantOrgEntitlement(db, {
      adminUserId,
      orgId: targetOrgId,
      resourceType: body.resourceType,
      bytes: body.bytes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      note: body.note,
    })
    if ('error' in result) return c.json({ error: result.error }, result.status)

    await recordActivity(db, {
      orgId: adminOrgId,
      userId: adminUserId,
      action: 'quota_entitlement_grant',
      targetType: 'quota',
      targetId: targetOrgId,
      targetName: targetOrgId,
      metadata: {
        targetOrgId,
        entitlementId: result.entitlement.id,
        resourceType: result.entitlement.resourceType,
        bytes: result.entitlement.bytes,
        expiresAt: result.entitlement.expiresAt?.toISOString() ?? null,
      },
    })

    return c.json(result, 201)
  })
  .patch('/:orgId/entitlements/:eid', zValidator('json', updateEntitlementSchema), async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const adminOrgId = c.get('orgId')!
    const targetOrgId = c.req.param('orgId')
    const body = c.req.valid('json')
    const result = await updateOrgEntitlement(db, {
      adminUserId,
      orgId: targetOrgId,
      entitlementId: c.req.param('eid'),
      bytes: body.bytes,
      expiresAt: 'expiresAt' in body ? (body.expiresAt ? new Date(body.expiresAt) : null) : undefined,
      note: body.note,
    })
    if ('error' in result) return c.json({ error: result.error }, result.status)

    await recordActivity(db, {
      orgId: adminOrgId,
      userId: adminUserId,
      action: 'quota_entitlement_update',
      targetType: 'quota',
      targetId: targetOrgId,
      targetName: targetOrgId,
      metadata: {
        targetOrgId,
        entitlementId: result.entitlement.id,
        bytes: result.entitlement.bytes,
        expiresAt: result.entitlement.expiresAt?.toISOString() ?? null,
      },
    })

    return c.json(result)
  })
  .delete('/:orgId/entitlements/:eid', async (c) => {
    const db = c.get('platform').db
    const adminUserId = c.get('userId')!
    const adminOrgId = c.get('orgId')!
    const targetOrgId = c.req.param('orgId')
    const result = await revokeOrgEntitlement(db, {
      adminUserId,
      orgId: targetOrgId,
      entitlementId: c.req.param('eid'),
    })
    if ('error' in result) return c.json({ error: result.error }, result.status)

    await recordActivity(db, {
      orgId: adminOrgId,
      userId: adminUserId,
      action: 'quota_entitlement_revoke',
      targetType: 'quota',
      targetId: targetOrgId,
      targetName: targetOrgId,
      metadata: {
        targetOrgId,
        entitlementId: result.entitlement.id,
        bytes: result.entitlement.bytes,
      },
    })

    return c.json(result)
  })
