import { describe, expect, it } from 'vitest'
import type { BindingState } from '../../shared/types'
import { hasFeature } from './has-feature'

describe('hasFeature', () => {
  it('returns false when state is null', () => {
    expect(hasFeature('white_label', null)).toBe(false)
  })

  it('returns false when state is unbound', () => {
    const state: BindingState = { bound: false }
    expect(hasFeature('white_label', state)).toBe(false)
  })

  it('returns false when bound but features list is empty', () => {
    const state: BindingState = { bound: true, plan: 'community', features: [] }
    expect(hasFeature('white_label', state)).toBe(false)
  })

  it('returns true when feature is in features list', () => {
    const state: BindingState = {
      bound: true,
      plan: 'pro',
      features: ['white_label', 'teams_unlimited'],
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }
    expect(hasFeature('white_label', state)).toBe(true)
  })

  it('returns false when feature is not in features list', () => {
    const state: BindingState = {
      bound: true,
      plan: 'pro',
      features: ['white_label'],
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }
    expect(hasFeature('teams_unlimited', state)).toBe(false)
  })

  it('returns false when entitlement has expired', () => {
    const state: BindingState = {
      bound: true,
      plan: 'pro',
      features: ['white_label'],
      expires_at: Math.floor(Date.now() / 1000) - 1, // 1 second in the past
    }
    expect(hasFeature('white_label', state)).toBe(false)
  })

  it('returns true when expires_at is in the future', () => {
    const state: BindingState = {
      bound: true,
      plan: 'pro',
      features: ['team_quotas'],
      expires_at: Math.floor(Date.now() / 1000) + 86400,
    }
    expect(hasFeature('team_quotas', state)).toBe(true)
  })

  it('returns true when expires_at is undefined (no expiry)', () => {
    const state: BindingState = {
      bound: true,
      plan: 'pro',
      features: ['open_registration'],
    }
    expect(hasFeature('open_registration', state)).toBe(true)
  })
})
