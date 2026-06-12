import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { organization } from '../db/auth-schema'
import { orgQuotas } from '../db/schema'
import { requireAdmin, requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { recordActivity } from '../services/activity'
import { getEffectiveQuota, getEffectiveQuotasByOrg } from '../services/effective-quota'
import { findPersonalOrg, isOrgOwner } from '../services/org'
import {
  grantOrgEntitlement,
  listOrgEntitlements,
  revokeOrgEntitlement,
  updateOrgEntitlement,
} from '../services/org-entitlements'
import { isTransferableEntitlement, transferEntitlementToOrg } from '../services/quota-allocation'

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

const adminQuotas = new Hono<Env>()
  .use(requireAdmin)
  .get('/', async (c) => {
    const db = c.get('platform').db
    const now = new Date()

    const rows = await db
      .select({
        id: orgQuotas.id,
        orgId: orgQuotas.orgId,
        orgName: organization.name,
        orgMetadata: organization.metadata,
      })
      .from(orgQuotas)
      .innerJoin(organization, eq(organization.id, orgQuotas.orgId))
      .orderBy(organization.name)

    const quotas = await getEffectiveQuotasByOrg(
      db,
      rows.map((r) => r.orgId),
      now,
    )

    const items = rows.map((r) => ({
      id: r.id,
      ...quotas.get(r.orgId)!,
      orgName: r.orgName,
      orgType: parseOrgType(r.orgMetadata),
    }))

    return c.json({ items, total: items.length })
  })
  .get('/:orgId/entitlements', async (c) => {
    const db = c.get('platform').db
    const result = await listOrgEntitlements(db, c.req.param('orgId'))
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

const transferEntitlementSchema = z.object({
  targetOrgId: z.string().min(1),
})

const userQuotas = new Hono<Env>()
  .use(requireAuth)
  .get('/me', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId') ?? (await findPersonalOrg(db, userId))

    if (!orgId) {
      return c.json({ error: 'No organization found' }, 404)
    }

    const quota = await getEffectiveQuota(db, orgId)
    return c.json(quota)
  })
  .get('/me/entitlements', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId') ?? (await findPersonalOrg(db, userId))
    if (!orgId) return c.json({ error: 'No organization found' }, 404)
    if (!(await isOrgOwner(db, userId, orgId))) return c.json({ error: 'Forbidden' }, 403)

    const result = await listOrgEntitlements(db, orgId)
    if ('error' in result) return c.json({ error: result.error }, result.status)
    const items = result.items.map((item) => ({ ...item, transferable: isTransferableEntitlement(item) }))
    return c.json({ orgId, items })
  })
  .post('/me/entitlements/:id/transfers', zValidator('json', transferEntitlementSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgId = c.get('orgId') ?? (await findPersonalOrg(db, userId))
    if (!orgId) return c.json({ error: 'No organization found' }, 404)

    const { targetOrgId } = c.req.valid('json')
    const result = await transferEntitlementToOrg(db, {
      userId,
      entitlementId: c.req.param('id'),
      sourceOrgId: orgId,
      targetOrgId,
    })
    if ('error' in result) return c.json({ error: result.error, code: result.code }, result.status)

    await recordActivity(db, {
      orgId,
      userId,
      action: 'quota_entitlement_allocate',
      targetType: 'quota',
      targetId: result.entitlement.id,
      targetName: targetOrgId,
      metadata: {
        entitlementId: result.entitlement.id,
        bytes: result.entitlement.bytes,
        targetOrgId,
      },
    })

    return c.json(result)
  })

export { adminQuotas, userQuotas }

function parseOrgType(metadata: string | null): string {
  if (!metadata) return 'unknown'
  try {
    return (JSON.parse(metadata) as { type?: string }).type ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
