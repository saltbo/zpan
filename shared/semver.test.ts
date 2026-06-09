import { describe, expect, it } from 'vitest'
import { compareSemver } from './semver'

describe('compareSemver', () => {
  it('orders by major, minor, then patch', () => {
    expect(compareSemver('2.8.0', '2.7.2')).toBe(1)
    expect(compareSemver('2.7.2', '2.8.0')).toBe(-1)
    expect(compareSemver('3.0.0', '2.9.9')).toBe(1)
    expect(compareSemver('2.7.3', '2.7.2')).toBe(1)
    expect(compareSemver('2.7.2', '2.7.2')).toBe(0)
  })

  it('tolerates a leading v and pre-release/build suffixes', () => {
    expect(compareSemver('v2.8.0', '2.7.2')).toBe(1)
    expect(compareSemver('2.8.0-beta.1', '2.8.0')).toBe(0)
  })

  it('returns 0 when either version is unparseable', () => {
    expect(compareSemver('not-a-version', '2.7.2')).toBe(0)
    expect(compareSemver('2.7.2', '')).toBe(0)
  })
})
