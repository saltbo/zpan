import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { checkoutSchema, cloudDeliveryPayloadSchema, redeemSchema } from '../../shared/schemas'
import { member, organization } from '../db/auth-schema'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import { findPersonalOrg } from '../services/org'
import {
  appendQuotaGrant,
  createCloudCheckout,
  findDeliveryEvent,
  getQuotaStorePackage,
  getQuotaStoreSettings,
  listQuotaGrants,
  listQuotaStorePackages,
  recordDeliveryEvent,
  sendCloudRedeem,
  verifyWebhookSignature,
} from '../services/quota-store'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns all org IDs the current user has access to purchase for
 * (personal org + teams they belong to as at least member).
 */
async function getAccessibleOrgIds(db: Parameters<typeof findPersonalOrg>[0], userId: string): Promise<string[]> {
  const personalOrgId = await findPersonalOrg(db, userId)
  const teamRows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
  const ids = new Set<string>()
  if (personalOrgId) ids.add(personalOrgId)
  for (const r of teamRows) ids.add(r.organizationId)
  return [...ids]
}

async function canAccessOrg(
  db: Parameters<typeof findPersonalOrg>[0],
  userId: string,
  orgId: string,
): Promise<boolean> {
  const accessibleIds = await getAccessibleOrgIds(db, userId)
  return accessibleIds.includes(orgId)
}

// ─── User-facing quota store routes ──────────────────────────────────────────

const userQuotaStore = new Hono<Env>()
  .use(requireAuth)
  .use(requireFeature('quota_store'))

  // GET /api/quota-store/packages — list active packages
  .get('/packages', async (c) => {
    const db = c.get('platform').db
    const packages = await listQuotaStorePackages(db, true)
    return c.json({ items: packages, total: packages.length })
  })

  // GET /api/quota-store/targets — orgs the current user can purchase for
  .get('/targets', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgIds = await getAccessibleOrgIds(db, userId)

    const targets = []
    for (const orgId of orgIds) {
      const [orgRow] = await db
        .select({ id: organization.id, name: organization.name, metadata: organization.metadata })
        .from(organization)
        .where(eq(organization.id, orgId))
      if (!orgRow) continue
      let orgType = 'unknown'
      try {
        orgType = (JSON.parse(orgRow.metadata ?? '{}') as { type?: string }).type ?? 'unknown'
      } catch {}
      targets.push({ orgId: orgRow.id, orgName: orgRow.name, orgType })
    }

    return c.json({ items: targets, total: targets.length })
  })

  // POST /api/quota-store/checkout — initiate Cloud purchase session
  .post('/checkout', zValidator('json', checkoutSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { packageId, targetOrgId } = c.req.valid('json')

    if (!(await canAccessOrg(db, userId, targetOrgId))) {
      return c.json({ error: 'Forbidden: no access to target org' }, 403)
    }

    const pkg = await getQuotaStorePackage(db, packageId)
    if (!pkg?.active) return c.json({ error: 'Package not found' }, 404)
    if (!pkg.cloudSyncId) return c.json({ error: 'Package not yet synced to Cloud' }, 422)

    const settings = await getQuotaStoreSettings(db)
    const cloudBaseUrl = settings.cloudBaseUrl ?? c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const instancePublicUrl = settings.instancePublicUrl ?? ''
    const callbackUrl = `${instancePublicUrl}/api/quota-store/webhooks/cloud`

    try {
      const { checkoutUrl } = await createCloudCheckout({
        cloudBaseUrl,
        instancePublicUrl,
        packageId,
        cloudSyncId: pkg.cloudSyncId,
        targetOrgId,
        userId,
        callbackUrl,
      })
      return c.json({ checkoutUrl })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: msg }, 502)
    }
  })

  // POST /api/quota-store/redemptions — redeem a code via Cloud
  .post('/redemptions', zValidator('json', redeemSchema), async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const { code, targetOrgId } = c.req.valid('json')

    if (!(await canAccessOrg(db, userId, targetOrgId))) {
      return c.json({ error: 'Forbidden: no access to target org' }, 403)
    }

    const settings = await getQuotaStoreSettings(db)
    const cloudBaseUrl = settings.cloudBaseUrl ?? c.get('platform').getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT
    const instancePublicUrl = settings.instancePublicUrl ?? ''

    try {
      const result = await sendCloudRedeem({
        cloudBaseUrl,
        instancePublicUrl,
        code,
        targetOrgId,
        userId,
      })
      return c.json(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: msg }, 502)
    }
  })

  // GET /api/quota-store/grants — list grants for accessible orgs
  .get('/grants', async (c) => {
    const db = c.get('platform').db
    const userId = c.get('userId')!
    const orgIds = await getAccessibleOrgIds(db, userId)
    const grants = await listQuotaGrants(db, orgIds)
    return c.json({ items: grants, total: grants.length })
  })

// ─── Cloud webhook (no auth — signature-verified) ─────────────────────────────

const quotaStoreWebhook = new Hono<Env>()

  // POST /api/quota-store/webhooks/cloud
  .post('/cloud', async (c) => {
    const db = c.get('platform').db
    const rawBody = await c.req.text()
    const signatureHeader = c.req.header('x-zpan-signature') ?? null

    const settings = await getQuotaStoreSettings(db)
    const secret = settings.webhookSigningSecret
    if (!secret) {
      return c.json({ error: 'Webhook signing secret not configured' }, 500)
    }

    if (!verifyWebhookSignature(secret, rawBody, signatureHeader)) {
      return c.json({ error: 'Invalid signature' }, 401)
    }

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'Malformed JSON payload' }, 400)
    }

    const parsed = cloudDeliveryPayloadSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400)
    }

    const payload = parsed.data

    // Idempotency check
    const existing = await findDeliveryEvent(db, payload.eventId)
    if (existing) {
      await recordDeliveryEvent(db, {
        eventId: payload.eventId,
        cloudOrderId: payload.cloudOrderId ?? null,
        rawPayload: rawBody,
        status: 'duplicate',
      })
      return c.json({ ok: true, duplicate: true })
    }

    // Validate target org exists
    const [orgRow] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, payload.targetOrgId))
    if (!orgRow) {
      await recordDeliveryEvent(db, {
        eventId: payload.eventId,
        cloudOrderId: payload.cloudOrderId ?? null,
        rawPayload: rawBody,
        status: 'error',
      })
      return c.json({ error: 'Target org not found' }, 404)
    }

    // Validate package (if packageId is a known package, check bytes match)
    const pkg = await getQuotaStorePackage(db, payload.packageId)
    if (pkg && pkg.bytes !== payload.bytes) {
      await recordDeliveryEvent(db, {
        eventId: payload.eventId,
        cloudOrderId: payload.cloudOrderId ?? null,
        rawPayload: rawBody,
        status: 'error',
      })
      return c.json({ error: 'Package bytes mismatch' }, 422)
    }

    // Record event and append grant atomically-ish
    await recordDeliveryEvent(db, {
      eventId: payload.eventId,
      cloudOrderId: payload.cloudOrderId ?? null,
      rawPayload: rawBody,
      status: 'processed',
    })

    const packageSnapshot = pkg ? JSON.stringify(pkg) : null
    await appendQuotaGrant(db, {
      orgId: payload.targetOrgId,
      source: payload.source,
      bytes: payload.bytes,
      externalEventId: payload.externalEventId ?? null,
      cloudOrderId: payload.cloudOrderId ?? null,
      code: payload.code ?? null,
      packageSnapshot,
      grantedBy: null,
      terminalUserId: null,
    })

    return c.json({ ok: true, duplicate: false })
  })

export { quotaStoreWebhook, userQuotaStore }
