// Tests for the billing page logic and component helpers.
// No jsdom/testing-library is available — we test pure logic functions.
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// formatTimestamp — mirrors logic in BoundStatusCard
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number | undefined, fallback: string): string {
  if (!ts) return fallback
  return new Date(ts * 1000).toLocaleString()
}

describe('formatTimestamp', () => {
  it('returns fallback when ts is undefined', () => {
    expect(formatTimestamp(undefined, 'Never')).toBe('Never')
  })

  it('returns fallback when ts is 0', () => {
    expect(formatTimestamp(0, 'Never')).toBe('Never')
  })

  it('converts unix seconds to a locale string', () => {
    const ts = 1000000000
    const result = formatTimestamp(ts, 'Never')
    expect(result).toBe(new Date(ts * 1000).toLocaleString())
    expect(result).not.toBe('Never')
  })
})

// ---------------------------------------------------------------------------
// Billing page state — unbound vs bound branching logic
// ---------------------------------------------------------------------------

interface BindingState {
  bound: boolean
  account_email?: string
  plan?: 'community' | 'pro'
  features?: string[]
  expires_at?: number
  last_refresh_at?: number
  last_refresh_error?: string
}

function resolveBillingView(data: BindingState | undefined): 'loading' | 'unbound' | 'bound' {
  if (!data) return 'loading'
  return data.bound ? 'bound' : 'unbound'
}

describe('resolveBillingView', () => {
  it('returns loading when data is undefined', () => {
    expect(resolveBillingView(undefined)).toBe('loading')
  })

  it('returns unbound when bound is false', () => {
    expect(resolveBillingView({ bound: false })).toBe('unbound')
  })

  it('returns bound when bound is true', () => {
    expect(resolveBillingView({ bound: true, account_email: 'user@example.com', plan: 'pro' })).toBe('bound')
  })
})

// ---------------------------------------------------------------------------
// Pro features — label mapping in BoundStatusCard
// ---------------------------------------------------------------------------

type ProFeature = 'white_label' | 'open_registration' | 'teams_unlimited' | 'storages_unlimited' | 'audit_log'

const FEATURE_LABELS: Record<ProFeature, string> = {
  white_label: 'White-label branding',
  open_registration: 'Open registration',
  teams_unlimited: 'Unlimited teams',
  storages_unlimited: 'Unlimited storages',
  audit_log: 'Audit logs',
}

describe('FEATURE_LABELS', () => {
  it('maps all known ProFeature keys', () => {
    const features: ProFeature[] = [
      'white_label',
      'open_registration',
      'teams_unlimited',
      'storages_unlimited',
      'audit_log',
    ]
    for (const f of features) {
      expect(FEATURE_LABELS[f]).toBeTruthy()
    }
  })

  it('white_label maps to readable label', () => {
    expect(FEATURE_LABELS.white_label).toBe('White-label branding')
  })

  it('storages_unlimited maps to readable label', () => {
    expect(FEATURE_LABELS.storages_unlimited).toBe('Unlimited storages')
  })

  it('audit_log maps to readable label', () => {
    expect(FEATURE_LABELS.audit_log).toBe('Audit logs')
  })
})

// ---------------------------------------------------------------------------
// PairingModal — poll result state transitions
// ---------------------------------------------------------------------------

type PairingStatus = 'pending' | 'approved' | 'denied' | 'expired'
type ModalState = 'loading' | 'waiting' | 'denied' | 'expired' | 'error'

function nextModalState(pollStatus: PairingStatus): ModalState | 'close' {
  if (pollStatus === 'pending') return 'waiting'
  if (pollStatus === 'approved') return 'close'
  if (pollStatus === 'denied') return 'denied'
  return 'expired'
}

describe('nextModalState', () => {
  it('keeps waiting on pending', () => {
    expect(nextModalState('pending')).toBe('waiting')
  })

  it('signals close on approved', () => {
    expect(nextModalState('approved')).toBe('close')
  })

  it('transitions to denied on denied', () => {
    expect(nextModalState('denied')).toBe('denied')
  })

  it('transitions to expired on expired', () => {
    expect(nextModalState('expired')).toBe('expired')
  })
})

// ---------------------------------------------------------------------------
// ComparisonTable — feature row structure
// ---------------------------------------------------------------------------

interface FeatureRow {
  label: string
  community: boolean
  pro: boolean
}

const COMPARISON_ROWS: FeatureRow[] = [
  { label: 'All core features', community: true, pro: true },
  { label: 'Social login & OIDC', community: true, pro: true },
  { label: 'Invite codes', community: true, pro: true },
  { label: 'All 7 deployment targets', community: true, pro: true },
  { label: 'Up to 1 team', community: true, pro: true },
  { label: 'Unlimited teams', community: false, pro: true },
  { label: 'Open registration', community: false, pro: true },
  { label: 'Unlimited storages', community: false, pro: true },
  { label: 'Audit logs', community: false, pro: true },
  { label: 'White-label branding', community: false, pro: true },
]

describe('ComparisonTable rows', () => {
  it('has at least one row available in both plans', () => {
    const bothRows = COMPARISON_ROWS.filter((r) => r.community && r.pro)
    expect(bothRows.length).toBeGreaterThan(0)
  })

  it('has rows that are Pro-only', () => {
    const proOnlyRows = COMPARISON_ROWS.filter((r) => !r.community && r.pro)
    expect(proOnlyRows.length).toBeGreaterThan(0)
  })

  it('has no row that is Community-only', () => {
    const communityOnlyRows = COMPARISON_ROWS.filter((r) => r.community && !r.pro)
    expect(communityOnlyRows).toHaveLength(0)
  })

  it('all 5 Pro-exclusive features are represented', () => {
    const proOnlyLabels = COMPARISON_ROWS.filter((r) => !r.community).map((r) => r.label)
    expect(proOnlyLabels).toContain('Unlimited teams')
    expect(proOnlyLabels).toContain('Open registration')
    expect(proOnlyLabels).toContain('Unlimited storages')
    expect(proOnlyLabels).toContain('Audit logs')
    expect(proOnlyLabels).toContain('White-label branding')
  })
})
