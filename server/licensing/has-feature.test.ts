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

  it('returns false when binding is present but inactive', () => {
    const state: BindingState = { bound: true, active: false }
    expect(hasFeature('white_label', state)).toBe(false)
  })

  it('returns true for local Pro gates when binding is active', () => {
    const state: BindingState = {
      bound: true,
      active: true,
      edition: 'pro',
      features: ['white_label', 'teams_unlimited', 'storages_unlimited'],
    }
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)
    expect(hasFeature('quota_store', state)).toBe(false)
  })

  it('falls back to non-commercial Pro gates for legacy Pro certificates without features', () => {
    const state: BindingState = { bound: true, active: true, edition: 'pro' }
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('quota_store', state)).toBe(false)
  })

  it('allows business gates when a Business binding is active', () => {
    const state: BindingState = { bound: true, active: true, edition: 'business', features: ['quota_store'] }
    expect(hasFeature('quota_store', state)).toBe(true)
    expect(hasFeature('white_label', state)).toBe(false)
  })
})
