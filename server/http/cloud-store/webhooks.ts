import { Hono } from 'hono'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { processDeliveryWebhook } from '../../usecases/cloud-store'
import { getCloudBaseUrl, parseJson, sha256Hex } from './helpers'

export const cloudStoreWebhooks = new Hono<Env>().use(requireFeature('quota_store')).post('/webhook', async (c) => {
  const rawPayload = await c.req.text()
  const outcome = await processDeliveryWebhook(c.get('deps'), {
    cloudBaseUrl: getCloudBaseUrl(c),
    eventToken: c.req.header('x-commerce-event-token') ?? '',
    rawPayload,
    payloadHash: await sha256Hex(rawPayload),
    body: parseJson(rawPayload),
  })
  if (outcome.ok) return c.json({ success: true, duplicate: outcome.duplicate, eventId: outcome.eventId })
  if (outcome.reason === 'invalid_token') return c.json({ error: 'invalid_event_token' }, 401)
  if (outcome.reason === 'invalid_payload') return c.json({ error: 'invalid_payload' }, 400)
  return c.json({ error: outcome.error }, 400)
})
