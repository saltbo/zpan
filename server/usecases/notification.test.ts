import { describe, expect, it, vi } from 'vitest'
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from './notification'
import type { ListNotificationsResult, NotificationRepo } from './ports'

function repo(over: Partial<NotificationRepo> = {}): { notifications: NotificationRepo } {
  return {
    notifications: {
      create: vi.fn(),
      list: vi.fn(async () => ({ items: [], total: 0, unreadCount: 0 })),
      markAsRead: vi.fn(async () => true),
      markAllAsRead: vi.fn(async () => ({ count: 0 })),
      unreadCount: vi.fn(async () => 0),
      ...over,
    } as NotificationRepo,
  }
}

describe('notification usecase', () => {
  it('lists notifications with the given paging options', async () => {
    const result: ListNotificationsResult = { items: [], total: 3, unreadCount: 1 }
    const list = vi.fn(async () => result)
    expect(await listNotifications(repo({ list }), 'u1', { page: 2, pageSize: 20, unreadOnly: true })).toBe(result)
    expect(list).toHaveBeenCalledWith('u1', { page: 2, pageSize: 20, unreadOnly: true })
  })

  it('returns the unread count', async () => {
    expect(await getUnreadCount(repo({ unreadCount: vi.fn(async () => 7) }), 'u1')).toBe(7)
  })

  it('marks a single notification read and reports whether it was found', async () => {
    const markAsRead = vi.fn(async () => false)
    expect(await markNotificationRead(repo({ markAsRead }), 'u1', 'n1')).toBe(false)
    expect(markAsRead).toHaveBeenCalledWith('u1', 'n1')
  })

  it('marks all notifications read and returns the count', async () => {
    expect(await markAllNotificationsRead(repo({ markAllAsRead: vi.fn(async () => ({ count: 5 })) }), 'u1')).toEqual({
      count: 5,
    })
  })
})
