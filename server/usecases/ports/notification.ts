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
  total: number
  unreadCount: number
}

export interface NotificationRepo {
  create(input: CreateNotificationInput): Promise<NotificationRecord>
  list(userId: string, opts: { page: number; pageSize: number; unreadOnly?: boolean }): Promise<ListNotificationsResult>
  markAsRead(userId: string, id: string): Promise<boolean>
  markAllAsRead(userId: string): Promise<{ count: number }>
  unreadCount(userId: string): Promise<number>
}
