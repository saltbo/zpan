import { describe, expect, it, vi } from 'vitest'
import { buildObjectKey } from './path-template.js'

const baseVars = {
  uid: 'user123',
  orgId: 'org456',
  rawName: 'photo',
  rawExt: '.jpg',
  uuid: 'abc-def-ghi',
}

describe('buildObjectKey', () => {
  it('replaces $UID', () => {
    expect(buildObjectKey('$UID/file', baseVars)).toBe('user123/file')
  })

  it('replaces $ORG_ID', () => {
    expect(buildObjectKey('$ORG_ID/file', baseVars)).toBe('org456/file')
  })

  it('replaces $UUID', () => {
    expect(buildObjectKey('$UUID/file', baseVars)).toBe('abc-def-ghi/file')
  })

  it('replaces $RAW_NAME and $RAW_EXT', () => {
    expect(buildObjectKey('$RAW_NAME$RAW_EXT', baseVars)).toBe('photo.jpg')
  })

  it('replaces $NOW_DATE, $NOW_YEAR, $NOW_MONTH, $NOW_DAY', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T12:00:00Z'))

    const result = buildObjectKey('$NOW_YEAR/$NOW_MONTH/$NOW_DAY/$NOW_DATE', baseVars)
    expect(result).toBe('2026/03/15/20260315')

    vi.useRealTimers()
  })

  it('replaces $RAND_16KEY with a 16-char string', () => {
    const result = buildObjectKey('$RAND_16KEY', baseVars)
    expect(result).toHaveLength(16)
  })

  it('uses default template when empty string given', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))

    const result = buildObjectKey('', baseVars)
    // Default: $UID/$NOW_DATE/$RAND_16KEY$RAW_EXT
    expect(result).toMatch(/^user123\/\d{8}\/.{16}\.jpg$/)

    vi.useRealTimers()
  })

  it('replaces multiple occurrences of the same variable', () => {
    expect(buildObjectKey('$UID/$UID', baseVars)).toBe('user123/user123')
  })

  it('leaves literal text untouched', () => {
    expect(buildObjectKey('prefix/$UID/suffix', baseVars)).toBe('prefix/user123/suffix')
  })

  it('handles empty rawExt', () => {
    const vars = { ...baseVars, rawExt: '' }
    expect(buildObjectKey('$RAW_NAME$RAW_EXT', vars)).toBe('photo')
  })
})
