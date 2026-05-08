import type { CloudOrderQuotaChange } from '@shared/schemas'

export function quotaChangeMetadata(event: CloudOrderQuotaChange) {
  return JSON.stringify({
    eventId: event.eventId,
    eventType: event.eventType,
    direction: event.direction,
    storageBytes: event.storageBytes,
    trafficBytes: event.trafficBytes,
    cloudOrderId: event.cloudOrderId ?? null,
    packageId: event.packageId ?? null,
  })
}

export function quotaChangeDate(event: CloudOrderQuotaChange) {
  return new Date(event.occurredAt ?? Date.now())
}
