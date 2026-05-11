import type { CloudOrder, CloudOrderItem } from '@shared/types'

export function cloudOrderStorageBytes(order: CloudOrder) {
  return cloudOrderItemStorageBytes(order.items[0])
}

export function cloudOrderTrafficBytes(order: CloudOrder) {
  return cloudOrderItemTrafficBytes(order.items[0])
}

export function cloudOrderItemStorageBytes(item: CloudOrderItem | undefined) {
  return item?.fulfillmentPayload.deliverable.storageBytes ?? 0
}

export function cloudOrderItemTrafficBytes(item: CloudOrderItem | undefined) {
  return item?.fulfillmentPayload.deliverable.trafficBytes ?? 0
}
