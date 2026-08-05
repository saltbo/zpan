import { describe, expect, it } from 'vitest'
import { imageTokenSchema, opaqueIdSchema, opaqueTokenSchema, shareTokenSchema } from './id'

describe('opaque ID schemas', () => {
  it.each(['0', 'abcXYZ123', 'A'.repeat(64)])('accepts Base62 value %s', (value) => {
    expect(opaqueIdSchema.parse(value)).toBe(value)
    expect(opaqueTokenSchema.parse(value)).toBe(value)
  })

  it.each(['', 'legacy_id', 'legacy-id', 'event:value', 'urn:value', 'é'])('rejects non-Base62 value %s', (value) => {
    expect(opaqueIdSchema.safeParse(value).success).toBe(false)
    expect(opaqueTokenSchema.safeParse(value).success).toBe(false)
  })

  it('keeps share and image public token namespaces disjoint', () => {
    expect(shareTokenSchema.parse('s0123456789A')).toBe('s0123456789A')
    expect(imageTokenSchema.parse('i0123456789A')).toBe('i0123456789A')
    expect(shareTokenSchema.safeParse('i0123456789A').success).toBe(false)
    expect(imageTokenSchema.safeParse('s0123456789A').success).toBe(false)
    expect(shareTokenSchema.safeParse('s0123456789').success).toBe(false)
    expect(imageTokenSchema.safeParse('i0123456789AB').success).toBe(false)
  })
})
