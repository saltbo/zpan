import { describe, expect, it } from 'vitest'
import {
  BASE62_ALPHABET,
  BASE62_PATTERN,
  DEFAULT_ID_LENGTH,
  generateId,
  generateImageToken,
  generateShareToken,
  generateToken,
  IMAGE_TOKEN_PATTERN,
  PUBLIC_TOKEN_LENGTH,
  PUBLIC_TOKEN_RANDOM_LENGTH,
  SHARE_TOKEN_PATTERN,
} from './ids'

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

  it.each([
    ['share', generateShareToken, SHARE_TOKEN_PATTERN],
    ['image', generateImageToken, IMAGE_TOKEN_PATTERN],
  ] as const)('generates %s public tokens with a fixed prefix and 11 random Base62 characters', (_, generate, pattern) => {
    const tokens = Array.from({ length: 10_000 }, generate)

    expect(PUBLIC_TOKEN_LENGTH).toBe(12)
    expect(PUBLIC_TOKEN_RANDOM_LENGTH * Math.log2(BASE62_ALPHABET.length)).toBeGreaterThan(65)
    expect(tokens.every((token) => token.length === PUBLIC_TOKEN_LENGTH && pattern.test(token))).toBe(true)
    expect(new Set(tokens).size).toBe(tokens.length)
  })
})
