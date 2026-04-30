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
    const state: BindingState = { bound: true, active: true, edition: 'pro' }
    expect(hasFeature('white_label', state)).toBe(true)
    expect(hasFeature('teams_unlimited', state)).toBe(true)
    expect(hasFeature('storages_unlimited', state)).toBe(true)
  })
})
