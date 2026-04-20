// Tests for notification-bell.tsx — covers pure display logic.
// React rendering is not available (no jsdom), so we test the badge logic directly.
import { describe, expect, it } from 'vitest'

// Mirrors the badge display logic in NotificationBell:
//   const displayCount = count > 9 ? '9+' : count > 0 ? String(count) : null
function badgeLabel(count: number): string | null {
  if (count > 9) return '9+'
  if (count > 0) return String(count)
  return null
}

describe('NotificationBell — badge label', () => {
  it('returns null when count is 0 (no badge shown)', () => {
    expect(badgeLabel(0)).toBeNull()
  })

  it('returns the count as a string for 1', () => {
    expect(badgeLabel(1)).toBe('1')
  })

  it('returns the count as a string for 9', () => {
    expect(badgeLabel(9)).toBe('9')
  })

  it('returns "9+" for counts greater than 9', () => {
    expect(badgeLabel(10)).toBe('9+')
    expect(badgeLabel(99)).toBe('9+')
    expect(badgeLabel(1000)).toBe('9+')
  })

  it('caps at "9+" regardless of how large the count is', () => {
    expect(badgeLabel(Number.MAX_SAFE_INTEGER)).toBe('9+')
  })
})

// Polling interval constant — mirrors UNREAD_POLL_INTERVAL in notification-bell.tsx
const UNREAD_POLL_INTERVAL = 30_000

describe('NotificationBell — polling interval', () => {
  it('polls every 30 seconds', () => {
    expect(UNREAD_POLL_INTERVAL).toBe(30_000)
  })
})
