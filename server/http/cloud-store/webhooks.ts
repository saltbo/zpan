import { cloudOrderQuotaChangeSchema } from '@shared/schemas'
import { Hono } from 'hono'
import { verifyCloudEventToken } from '../../licensing/cloud-event-token'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { getCloudBaseUrl, parseJson, sha256Hex } from '../cloud-store-helpers'

export const cloudStoreWebhooks = new Hono<Env>().use(requireFeature('quota_store')).post('/webhook', async (c) => {
  const binding = await c.get('deps').cloudStore.getCloudStoreBinding()
  const rawPayload = await c.req.text()
  const payloadHash = await sha256Hex(rawPayload)
  const eventToken = c.req.header('x-commerce-event-token') ?? ''
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
    const result = await c.get('deps').cloudStore.processCloudOrderQuotaChange(parsed.data, rawPayload, payloadHash)
    return c.json({ success: true, duplicate: result.duplicate, eventId: result.eventId })
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})
