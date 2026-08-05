import { describe, expect, it, vi } from 'vitest'
import { buildImageStorageKey, buildObjectKey, fileExt } from './path-template.js'

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
    // Base62 needs 17 characters to preserve the former 16-character Nano ID entropy.
    expect(result).toMatch(/^org456\/user123\/20260315\/[A-Za-z0-9]{17}\.jpg$/)

    vi.useRealTimers()
  })

  it('includes a 17-character Base62 random key', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey(baseVars)
    const parts = result.split('/')
    const filename = parts[3]
    expect(filename.replace('.jpg', '')).toHaveLength(17)

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

  it('accepts legacy owner IDs while keeping the generated key segment Base62', () => {
    const result = buildObjectKey({ ...baseVars, orgId: 'legacy_org', uid: 'legacy-user' })
    expect(result).toMatch(/^legacy_org\/legacy-user\/\d{8}\/[A-Za-z0-9]{17}\.jpg$/)
  })

  it.each([
    ['organization ID', { ...baseVars, orgId: 'invalid/org' }],
    ['user ID', { ...baseVars, uid: 'invalid:user' }],
  ])('rejects an unsafe %s before creating a key', (component, vars) => {
    expect(() => buildObjectKey(vars)).toThrow(`Invalid ${component} for object storage key`)
  })
})

describe('buildImageStorageKey', () => {
  it('uses compatible opaque ID components under the image namespace', () => {
    expect(buildImageStorageKey('org123', 'imageABC123', 'png')).toBe('ih/org123/imageABC123.png')
    expect(buildImageStorageKey('legacy_org', 'legacy-image', 'png')).toBe('ih/legacy_org/legacy-image.png')
  })

  it.each([
    ['organization ID', 'invalid/org', 'imageABC123', 'png'],
    ['image ID', 'org123', 'invalid:image', 'png'],
    ['extension', 'org123', 'imageABC123', 'png/other'],
  ])('rejects an invalid %s component', (_component, orgId, imageId, extension) => {
    expect(() => buildImageStorageKey(orgId, imageId, extension)).toThrow(/Invalid .* for image storage key/)
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
