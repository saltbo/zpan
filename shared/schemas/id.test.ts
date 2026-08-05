import { describe, expect, it } from 'vitest'
import { base62IdSchema, imageTokenSchema, opaqueIdSchema, opaqueTokenSchema, shareTokenSchema } from './id'

describe('opaque ID schemas', () => {
  it.each([
    '0',
    'abcXYZ123',
    'A'.repeat(64),
    'legacy_id',
    'legacy-id',
  ])('accepts current and legacy value %s', (value) => {
    expect(opaqueIdSchema.parse(value)).toBe(value)
    expect(opaqueTokenSchema.parse(value)).toBe(value)
  })

  it.each(['', 'event:value', 'urn:value', 'path/value', 'value.with-dot', 'é'])('rejects unsafe value %s', (value) => {
    expect(opaqueIdSchema.safeParse(value).success).toBe(false)
    expect(opaqueTokenSchema.safeParse(value).success).toBe(false)
  })

  it('keeps newly created IDs on the strict Base62 contract', () => {
    expect(base62IdSchema.parse('abcXYZ123')).toBe('abcXYZ123')
    expect(base62IdSchema.safeParse('legacy_id').success).toBe(false)
    expect(base62IdSchema.safeParse('legacy-id').success).toBe(false)
  })

  it('keeps share and image public token namespaces disjoint', () => {
    expect(shareTokenSchema.parse('s0123456789A')).toBe('s0123456789A')
    expect(imageTokenSchema.parse('i0123456789A')).toBe('i0123456789A')
    expect(shareTokenSchema.safeParse('i0123456789A').success).toBe(false)
    expect(imageTokenSchema.safeParse('s0123456789A').success).toBe(false)
    expect(shareTokenSchema.safeParse('s0123456789').success).toBe(false)
    expect(imageTokenSchema.safeParse('i0123456789AB').success).toBe(false)
  })

  it('accepts legacy public tokens without weakening their resource namespace', () => {
    expect(shareTokenSchema.parse('ds_legacy-token')).toBe('ds_legacy-token')
    expect(shareTokenSchema.parse('legacy_id0')).toBe('legacy_id0')
    expect(imageTokenSchema.parse('ih_legacy-token')).toBe('ih_legacy-token')
    expect(imageTokenSchema.safeParse('ds_legacy-token').success).toBe(false)
  })
})
