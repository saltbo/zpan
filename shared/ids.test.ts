import { describe, expect, it } from 'vitest'
import { BASE62_ALPHABET, BASE62_PATTERN, DEFAULT_ID_LENGTH, generateId, generateToken } from './ids'

describe('Base62 identifiers', () => {
  it('uses the fixed 0-9A-Za-z alphabet', () => {
    expect(BASE62_ALPHABET).toBe('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
  })

  it('generates default IDs with at least the entropy of Nano ID defaults', () => {
    const ids = Array.from({ length: 1_000 }, () => generateId())

    expect(DEFAULT_ID_LENGTH * Math.log2(BASE62_ALPHABET.length)).toBeGreaterThanOrEqual(21 * Math.log2(64))
    expect(ids.every((id) => id.length === DEFAULT_ID_LENGTH && BASE62_PATTERN.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('generates requested token lengths without collisions in a representative sample', () => {
    const tokens = Array.from({ length: 10_000 }, () => generateToken(11))

    expect(tokens.every((token) => token.length === 11 && BASE62_PATTERN.test(token))).toBe(true)
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})
