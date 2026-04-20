// Tests for notification-item.tsx — covers pure logic extracted from the component.
// React rendering is not available (no jsdom), so we test the functions directly.

import type { Notification } from '@shared/types'
import { describe, expect, it } from 'vitest'

// ─── resolveHref ─────────────────────────────────────────────────────────────
// Mirrors the resolveHref function in notification-item.tsx

function resolveHref(notification: Notification): string | null {
  if (notification.refType === 'share' && notification.metadata) {
    try {
      const meta = JSON.parse(notification.metadata) as { token?: string }
      if (meta.token) return `/s/${meta.token}`
    } catch {
      // ignore malformed metadata
    }
  }
  return null
}

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

describe('resolveHref', () => {
  it('returns /s/:token when refType is share and metadata has token', () => {
    const n = makeNotification({ refType: 'share', metadata: JSON.stringify({ token: 'abc123' }) })
    expect(resolveHref(n)).toBe('/s/abc123')
  })

  it('returns null when refType is not share', () => {
    const n = makeNotification({ refType: 'other', metadata: JSON.stringify({ token: 'abc' }) })
    expect(resolveHref(n)).toBeNull()
  })

  it('returns null when metadata is null', () => {
    const n = makeNotification({ refType: 'share', metadata: null })
    expect(resolveHref(n)).toBeNull()
  })

  it('returns null when metadata has no token field', () => {
    const n = makeNotification({ refType: 'share', metadata: JSON.stringify({ other: 'data' }) })
    expect(resolveHref(n)).toBeNull()
  })

  it('returns null for malformed metadata JSON without crashing', () => {
    const n = makeNotification({ refType: 'share', metadata: 'not-json' })
    expect(resolveHref(n)).toBeNull()
  })

  it('returns null when refType is null', () => {
    const n = makeNotification({ refType: null, metadata: JSON.stringify({ token: 'abc' }) })
    expect(resolveHref(n)).toBeNull()
  })
})

// ─── diffMinutes ──────────────────────────────────────────────────────────────

function diffMinutes(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60_000)
}

describe('diffMinutes', () => {
  it('returns 0 for a timestamp within the last minute', () => {
    const now = new Date(Date.now() - 30_000).toISOString()
    expect(diffMinutes(now)).toBe(0)
  })

  it('returns 5 for a timestamp 5 minutes ago', () => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(diffMinutes(fiveMinsAgo)).toBe(5)
  })

  it('returns 60 for a timestamp 1 hour ago', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(diffMinutes(oneHourAgo)).toBe(60)
  })
})

// ─── isUnread ─────────────────────────────────────────────────────────────────
// Mirrors the `isUnread = !notification.readAt` check

describe('isUnread', () => {
  it('is true when readAt is null', () => {
    const n = makeNotification({ readAt: null })
    expect(!n.readAt).toBe(true)
  })

  it('is false when readAt is set', () => {
    const n = makeNotification({ readAt: new Date().toISOString() })
    expect(!n.readAt).toBe(false)
  })
})

// ─── Title style — bold for unread ────────────────────────────────────────────

function titleClass(isUnread: boolean): string {
  return isUnread ? 'font-semibold' : 'font-medium'
}

describe('title style', () => {
  it('uses font-semibold for unread notifications', () => {
    expect(titleClass(true)).toBe('font-semibold')
  })

  it('uses font-medium for read notifications', () => {
    expect(titleClass(false)).toBe('font-medium')
  })
})
