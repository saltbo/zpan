import { cloudOrderQuotaChangeSchema } from '@shared/schemas'
import { Hono } from 'hono'
import { verifyCloudEventToken } from '../../licensing/cloud-event-token'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { getCloudStoreBinding, getRequiredSettings, processCloudOrderQuotaChange } from '../../services/cloud-store'
import { requestBoundCloudJson } from '../../services/licensing-cloud'
import { getCloudBaseUrl, parseJson, type RouteContext, sha256Hex } from '../cloud-store-helpers'

export const cloudStoreWebhooks = new Hono<Env>().use(requireFeature('quota_store')).post('/cloud', async (c) => {
  const db = c.get('platform').db
  await getRequiredSettings(db)
  const binding = await getCloudStoreBinding(db)
  const rawPayload = await c.req.text()
  const payloadHash = await sha256Hex(rawPayload)
  const eventToken = c.req.header('x-zpan-cloud-event-token') ?? ''
  const eventAuth = verifyCloudEventToken(eventToken, {
    cloudBaseUrl: getCloudBaseUrl(c),
    instanceId: binding.instanceId,
    boundLicenseId: binding.boundLicenseId,
    payloadHash,
  })
  if (!eventAuth) return c.json({ error: 'invalid_event_token' }, 401)

  const body = parseJson(rawPayload)
  if (!body) return c.json({ error: 'invalid_payload' }, 400)

  const parsed = cloudOrderQuotaChangeSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'invalid_payload' }, 400)
  if (parsed.data.eventId !== eventAuth.eventId) return c.json({ error: 'invalid_event_token' }, 401)

  try {
    await applySubscriptionOverageCap(c, binding.refreshToken, parsed.data)
    const result = await processCloudOrderQuotaChange(db, parsed.data, rawPayload, payloadHash)
    return c.json({ success: true, duplicate: result.duplicate, eventId: result.eventId })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

async function applySubscriptionOverageCap(
  c: RouteContext,
  refreshToken: string,
  event: ReturnType<typeof cloudOrderQuotaChangeSchema.parse>,
) {
  if (event.source !== 'stripe_subscription') return
  await requestBoundCloudJson(getCloudBaseUrl(c), '/api/accounts/me/overage-cap', refreshToken, {
    method: 'PUT',
    payload: {
      customerId: event.targetOrgId,
      capCents: event.direction === 'increase' ? (event.overageCapCents ?? 0) : 0,
    },
  })
}
