import { describe, expect, it, vi } from 'vitest'
import { buildObjectKey } from './path-template.js'

const baseVars = {
  uid: 'user123',
  orgId: 'org456',
  rawExt: '.jpg',
}

describe('buildObjectKey', () => {
  it('produces tenant-isolated key with fixed template', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey(baseVars)
    // Template: $ORG_ID/$UID/$NOW_DATE/$RAND_16KEY$RAW_EXT
    expect(result).toMatch(/^org456\/user123\/20260315\/.{16}\.jpg$/)

    vi.useRealTimers()
  })

  it('includes a 16-char random key', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey(baseVars)
    const parts = result.split('/')
    const filename = parts[3] // RAND_16KEY + ext
    expect(filename.replace('.jpg', '')).toHaveLength(16)

    vi.useRealTimers()
  })

  it('handles empty rawExt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey({ ...baseVars, rawExt: '' })
    expect(result).toMatch(/^org456\/user123\/20260315\/.{16}$/)

    vi.useRealTimers()
  })

  it('generates unique keys on each call', () => {
    const a = buildObjectKey(baseVars)
    const b = buildObjectKey(baseVars)
    expect(a).not.toBe(b)
  })
})
