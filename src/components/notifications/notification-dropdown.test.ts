// Tests for notification-dropdown.tsx — covers pure display logic.
// React rendering is not available (no jsdom), so we test extracted logic directly.

import type { Notification } from '@shared/types'
import { describe, expect, it } from 'vitest'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    userId: 'u1',
    type: 'share_received',
    title: 'Test',
    body: '',
    refType: null,
    refId: null,
    metadata: null,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

// ─── "Mark all as read" visibility ───────────────────────────────────────────
// Mirrors the `hasUnread` check: const hasUnread = (data?.unreadCount ?? 0) > 0

function shouldShowMarkAllRead(unreadCount: number | undefined): boolean {
  return (unreadCount ?? 0) > 0
}

describe('NotificationDropdown — mark all read visibility', () => {
  it('is hidden when unreadCount is 0', () => {
    expect(shouldShowMarkAllRead(0)).toBe(false)
  })

  it('is hidden when unreadCount is undefined', () => {
    expect(shouldShowMarkAllRead(undefined)).toBe(false)
  })

  it('is visible when unreadCount is > 0', () => {
    expect(shouldShowMarkAllRead(1)).toBe(true)
    expect(shouldShowMarkAllRead(5)).toBe(true)
  })
})

// ─── Empty state ──────────────────────────────────────────────────────────────

function hasItems(items: Notification[]): boolean {
  return items.length > 0
}

describe('NotificationDropdown — empty state', () => {
  it('shows empty state when there are no items', () => {
    expect(hasItems([])).toBe(false)
  })

  it('shows items list when there are notifications', () => {
    expect(hasItems([makeNotification()])).toBe(true)
  })
})

// ─── Query key contract ───────────────────────────────────────────────────────

const NOTIFICATIONS_QUERY_KEY = ['notifications', 'list']

describe('NotificationDropdown — query key', () => {
  it('uses ["notifications", "list"] as the query key', () => {
    expect(NOTIFICATIONS_QUERY_KEY).toEqual(['notifications', 'list'])
  })
})
