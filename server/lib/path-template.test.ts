import { describe, expect, it, vi } from 'vitest'
import { buildObjectKey, fileExt } from './path-template.js'

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
    // 17 Base62 characters preserve the entropy of the previous 16-character Nano ID.
    expect(result).toMatch(/^org456\/user123\/20260315\/[A-Za-z0-9]{17}\.jpg$/)

    vi.useRealTimers()
  })

  it('includes a 17-char Base62 random key', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey(baseVars)
    const parts = result.split('/')
    const filename = parts[3] // RAND_16KEY + ext
    expect(filename.replace('.jpg', '')).toMatch(/^[A-Za-z0-9]{17}$/)

    vi.useRealTimers()
  })

  it('handles empty rawExt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey({ ...baseVars, rawExt: '' })
    expect(result).toMatch(/^org456\/user123\/20260315\/[A-Za-z0-9]{17}$/)

    vi.useRealTimers()
  })

  it('generates unique keys on each call', () => {
    const a = buildObjectKey(baseVars)
    const b = buildObjectKey(baseVars)
    expect(a).not.toBe(b)
  })
})

describe('fileExt', () => {
  it('returns the extension with the leading dot', () => {
    expect(fileExt('photo.jpg')).toBe('.jpg')
    expect(fileExt('archive.tar.gz')).toBe('.gz')
    expect(fileExt('.hidden')).toBe('.hidden')
  })

  it('returns empty string when there is no extension', () => {
    expect(fileExt('README')).toBe('')
    expect(fileExt('')).toBe('')
  })
})
