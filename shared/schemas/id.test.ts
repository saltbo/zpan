import { describe, expect, it } from 'vitest'
import { opaqueIdSchema, opaqueTokenSchema } from './id'

describe('opaque ID schemas', () => {
  it.each(['0', 'abcXYZ123', 'A'.repeat(64)])('accepts Base62 value %s', (value) => {
    expect(opaqueIdSchema.parse(value)).toBe(value)
    expect(opaqueTokenSchema.parse(value)).toBe(value)
  })

  it.each(['', 'legacy_id', 'legacy-id', 'event:value', 'urn:value', 'é'])('rejects non-Base62 value %s', (value) => {
    expect(opaqueIdSchema.safeParse(value).success).toBe(false)
    expect(opaqueTokenSchema.safeParse(value).success).toBe(false)
  })
})
