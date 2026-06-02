import type { CloudOrder, CloudOrderItem } from '@shared/types'

export function cloudOrderStorageBytes(order: CloudOrder) {
  return cloudOrderItemStorageBytes(order.items[0])
}

export function cloudOrderTrafficBytes(order: CloudOrder) {
  return cloudOrderItemTrafficBytes(order.items[0])
}

export function cloudOrderItemStorageBytes(item: CloudOrderItem | undefined) {
  return cloudOrderItemDeliverableNumber(item, 'storageBytes')
}

export function cloudOrderItemTrafficBytes(item: CloudOrderItem | undefined) {
  return cloudOrderItemDeliverableNumber(item, 'trafficBytes')
}

function cloudOrderItemDeliverableNumber(item: CloudOrderItem | undefined, key: string) {
  const deliverable = item?.fulfillmentPayload.deliverable as Record<string, unknown> | undefined
  const value = deliverable?.[key]
  return typeof value === 'number' ? value : 0
}
