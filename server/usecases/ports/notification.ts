import type { NotificationType } from '@shared/types'

export interface NotificationRecord {
  id: string
  userId: string
  type: NotificationType
  title: string
  body: string
  refType: string | null
  refId: string | null
  metadata: string | null
  readAt: Date | null
  createdAt: Date
}

export interface CreateNotificationInput {
  userId: string
  type: NotificationType
  title: string
  body?: string
  refType?: string
  refId?: string
  metadata?: string
}

export interface ListNotificationsResult {
  items: NotificationRecord[]
  nextBoundary: { createdAt: Date; id: string } | null
}

export interface NotificationRepo {
  create(input: CreateNotificationInput): Promise<NotificationRecord>
  list(
    userId: string,
    opts: { pageSize: number; unreadOnly?: boolean; after?: { createdAt: Date; id: string } },
  ): Promise<ListNotificationsResult>
  markAsRead(userId: string, id: string): Promise<boolean>
  markAllAsRead(userId: string): Promise<{ count: number }>
  unreadCount(userId: string): Promise<number>
}
