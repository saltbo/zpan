import { Hono } from 'hono'
import { recordAuditEffect } from '../../lib/audit'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import type { RecordAuditEventInput } from '../../usecases/ports'
import { processDeliveryWebhook } from '../../usecases/store/store'
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
  if (!outcome.ok) throw outcome.error
  const event = outcome.receipt
  const auditEvent: RecordAuditEventInput = {
    orgId: event.targetOrgId,
    userId: null,
    actorType: 'system',
    actorRef: 'cloud-store',
    action: `quota_order_${event.direction}`,
    targetType: 'quota',
    targetId: event.targetOrgId,
    targetName: event.targetOrgId,
    metadata: {
      eventId: event.eventId,
      eventType: event.eventType,
      customerId: event.customerId ?? null,
      direction: event.direction,
      storageBytes: event.storageBytes,
      trafficBytes: event.trafficBytes,
      cloudOrderId: event.cloudOrderId ?? null,
      packageName: event.packageName ?? null,
    },
  }
  await recordAuditEffect(auditEvent.action, () =>
    c
      .get('deps')
      .audit.recordOnce(auditEvent, `cloud-store:${event.eventId}`, new Date(event.occurredAt ?? Date.now())),
  )
  return c.json({ success: true, duplicate: outcome.duplicate, eventId: outcome.eventId })
})
