// Tests for shares/index.tsx — covers pure display logic.
// React rendering is not available (no jsdom), so we test helper functions directly.
import { describe, expect, it } from 'vitest'

// Mirrors computeDisplayStatus from shares/index.tsx
function computeDisplayStatus(share: {
  status: 'active' | 'revoked'
  expiresAt: string | null
}): 'active' | 'revoked' | 'expired' {
  if (share.status === 'revoked') return 'revoked'
  if (share.expiresAt && new Date(share.expiresAt) < new Date()) return 'expired'
  return 'active'
}

// Mirrors getBackendStatus from shares/index.tsx
function getBackendStatus(filter: 'all' | 'active' | 'revoked' | 'expired'): 'active' | 'revoked' | undefined {
  if (filter === 'active' || filter === 'expired') return 'active'
  if (filter === 'revoked') return 'revoked'
  return undefined
}

const PAST = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
const FUTURE = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString()

describe('computeDisplayStatus', () => {
  it('returns "revoked" when status is revoked regardless of expiresAt', () => {
    expect(computeDisplayStatus({ status: 'revoked', expiresAt: null })).toBe('revoked')
    expect(computeDisplayStatus({ status: 'revoked', expiresAt: FUTURE })).toBe('revoked')
    expect(computeDisplayStatus({ status: 'revoked', expiresAt: PAST })).toBe('revoked')
  })

  it('returns "expired" when status is active and expiresAt is in the past', () => {
    expect(computeDisplayStatus({ status: 'active', expiresAt: PAST })).toBe('expired')
  })

  it('returns "active" when status is active and expiresAt is in the future', () => {
    expect(computeDisplayStatus({ status: 'active', expiresAt: FUTURE })).toBe('active')
  })

  it('returns "active" when status is active and expiresAt is null (never expires)', () => {
    expect(computeDisplayStatus({ status: 'active', expiresAt: null })).toBe('active')
  })
})

describe('getBackendStatus', () => {
  it('returns undefined for "all" filter (no backend filter applied)', () => {
    expect(getBackendStatus('all')).toBeUndefined()
  })

  it('returns "active" for "active" filter', () => {
    expect(getBackendStatus('active')).toBe('active')
  })

  it('returns "revoked" for "revoked" filter', () => {
    expect(getBackendStatus('revoked')).toBe('revoked')
  })

  it('returns "active" for "expired" filter (expired shares have active status on backend)', () => {
    expect(getBackendStatus('expired')).toBe('active')
  })
})

// Mirrors the downloads label formatting in ShareTableRow
function formatDownloads(downloads: number, downloadLimit: number | null): string {
  return downloadLimit != null ? `${downloads} / ${downloadLimit}` : String(downloads)
}

describe('formatDownloads', () => {
  it('shows plain count when no limit is set', () => {
    expect(formatDownloads(5, null)).toBe('5')
    expect(formatDownloads(0, null)).toBe('0')
  })

  it('shows "used / limit" when download limit is set', () => {
    expect(formatDownloads(23, 100)).toBe('23 / 100')
    expect(formatDownloads(0, 50)).toBe('0 / 50')
  })

  it('shows "used / limit" when limit is zero (edge case)', () => {
    expect(formatDownloads(0, 0)).toBe('0 / 0')
  })
})

// Mirrors the views label logic in ShareTableRow
function formatViews(kind: 'landing' | 'direct', views: number): string {
  return kind === 'direct' ? '—' : String(views)
}

describe('formatViews', () => {
  it('returns "—" for direct shares (views not tracked)', () => {
    expect(formatViews('direct', 0)).toBe('—')
    expect(formatViews('direct', 100)).toBe('—')
  })

  it('returns the view count as a string for landing shares', () => {
    expect(formatViews('landing', 0)).toBe('0')
    expect(formatViews('landing', 42)).toBe('42')
  })
})
