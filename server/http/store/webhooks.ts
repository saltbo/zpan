import { Hono } from 'hono'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { processDeliveryWebhook } from '../../usecases/store/store'
import { apiError } from '../openapi'
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
  if (outcome.reason === 'invalid_token')
    return apiError(c, 401, 'Invalid event token', { reason: 'INVALID_EVENT_TOKEN' })
  if (outcome.reason === 'invalid_payload') return apiError(c, 400, 'Invalid payload', { reason: 'INVALID_PAYLOAD' })
  return apiError(c, 400, outcome.error)
})
