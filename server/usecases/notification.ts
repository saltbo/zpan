// The notifications resource usecase (/api/notifications). All routes are
// owner-scoped single-port operations; they go through here so the boundary
// rule (no deps.<port> access in http) holds uniformly and the resource has one
// home.

import type { ListNotificationsResult, NotificationRepo } from './ports'

type NotificationDeps = { notifications: NotificationRepo }

export function listNotifications(
  deps: NotificationDeps,
  userId: string,
  opts: { page: number; pageSize: number; unreadOnly: boolean },
): Promise<ListNotificationsResult> {
  return deps.notifications.list(userId, opts)
}

export function getUnreadCount(deps: NotificationDeps, userId: string): Promise<number> {
  return deps.notifications.unreadCount(userId)
}

export function markNotificationRead(deps: NotificationDeps, userId: string, id: string): Promise<boolean> {
  return deps.notifications.markAsRead(userId, id)
}

export function markAllNotificationsRead(deps: NotificationDeps, userId: string): Promise<{ count: number }> {
  return deps.notifications.markAllAsRead(userId)
}
