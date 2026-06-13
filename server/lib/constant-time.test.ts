import { describe, expect, it } from 'vitest'
import { constantTimeEqual } from './constant-time'

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('Bearer abc123', 'Bearer abc123')).toBe(true)
    expect(constantTimeEqual('', '')).toBe(true)
  })

  it('returns false for differing strings of equal length', () => {
    expect(constantTimeEqual('Bearer abc123', 'Bearer abc124')).toBe(false)
  })

  it('returns false for differing lengths', () => {
    expect(constantTimeEqual('short', 'longer-token')).toBe(false)
    expect(constantTimeEqual('abc', '')).toBe(false)
  })
})
