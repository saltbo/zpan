import { describe, expect, it } from 'vitest'
import type { BindingState } from '../../shared/types'
import { hasFeature } from './licensing'

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

  it('grants non-commercial Pro gates for an active Pro binding, but not business-only gates', () => {
    const state: BindingState = { bound: true, active: true, edition: 'pro' }
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)
    expect(hasFeature('analytics', state)).toBe(true)
    expect(hasFeature('quota_store', state)).toBe(false)
    expect(hasFeature('site_announcements', state)).toBe(false)
  })

  it('grants all gates for an active Business binding', () => {
    const state: BindingState = { bound: true, active: true, edition: 'business' }
    expect(hasFeature('quota_store', state)).toBe(true)
    expect(hasFeature('site_announcements', state)).toBe(true)
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('analytics', state)).toBe(true)
  })
})
