import { describe, expect, it } from 'vitest'
import { formatDate, formatSize } from './format-utils'

describe('formatDate', () => {
  it('returns a non-empty string for a valid ISO date string', () => {
    const result = formatDate('2024-01-15T10:30:00.000Z')
    expect(result).not.toBe('—')
    expect(result.length).toBeGreaterThan(0)
  })

  it('returns the em-dash for an invalid date string', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('returns the em-dash for an empty string', () => {
    expect(formatDate('')).toBe('—')
  })

  it('returns a locale-formatted date for a Unix epoch string', () => {
    const result = formatDate('1970-01-01T00:00:00.000Z')
    expect(result).not.toBe('—')
  })

  it('returns a non-empty string for a valid date-only string', () => {
    const result = formatDate('2025-06-30')
    expect(result).not.toBe('—')
  })
})

describe('formatSize', () => {
  it('returns "0 B" for 0 bytes', () => {
    expect(formatSize(0)).toBe('0 B')
  })

  it('returns bytes label for values under 1024', () => {
    expect(formatSize(1)).toBe('1 B')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1023)).toBe('1023 B')
  })

  it('returns "1.0 KB" for exactly 1024 bytes', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
  })

  it('returns KB for values in the kilobyte range', () => {
    expect(formatSize(1536)).toBe('1.5 KB')
    expect(formatSize(10240)).toBe('10.0 KB')
  })

  it('returns "1.0 MB" for exactly 1 MB', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('returns MB for values in the megabyte range', () => {
    expect(formatSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })

  it('returns "1.0 GB" for exactly 1 GB', () => {
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })

  it('returns GB for values in the gigabyte range', () => {
    expect(formatSize(1024 ** 3 * 3)).toBe('3.0 GB')
  })

  it('returns "1.0 TB" for exactly 1 TB', () => {
    expect(formatSize(1024 ** 4)).toBe('1.0 TB')
  })

  it('returns a decimal value for fractional KB', () => {
    const result = formatSize(1500)
    expect(result).toContain('KB')
    expect(result).toContain('1.')
  })
})
