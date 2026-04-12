import { describe, expect, it } from 'vitest'
import { formatDate, formatSize } from './format'

describe('formatSize', () => {
  it('returns "0 B" for 0 bytes', () => {
    expect(formatSize(0)).toBe('0 B')
  })

  it('returns bytes with no decimal for values under 1 KB', () => {
    expect(formatSize(512)).toBe('512 B')
  })

  it('returns KB with one decimal for kilobyte values', () => {
    expect(formatSize(1024)).toBe('1.0 KB')
  })

  it('returns MB with one decimal for megabyte values', () => {
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
  })

  it('returns GB with one decimal for gigabyte values', () => {
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.0 GB')
  })

  it('returns TB with one decimal for terabyte values', () => {
    expect(formatSize(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB')
  })

  it('returns fractional KB for values between 1 KB and 1 MB', () => {
    expect(formatSize(1536)).toBe('1.5 KB')
  })

  it('returns fractional GB for non-round gigabyte values', () => {
    expect(formatSize(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })

  it('returns single byte without decimal', () => {
    expect(formatSize(1)).toBe('1 B')
  })

  it('returns 10 GB correctly', () => {
    expect(formatSize(10 * 1024 * 1024 * 1024)).toBe('10.0 GB')
  })

  it('returns 100 MB correctly', () => {
    expect(formatSize(100 * 1024 * 1024)).toBe('100.0 MB')
  })
})

describe('formatDate', () => {
  it('returns a locale date string for a valid ISO timestamp', () => {
    const result = formatDate('2024-01-15T00:00:00.000Z')
    expect(result).toBeTruthy()
    expect(result).not.toBe('—')
  })

  it('returns "—" for an empty string', () => {
    expect(formatDate('')).toBe('—')
  })

  it('returns "—" for a non-date string', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('returns "—" for a random invalid string', () => {
    expect(formatDate('foobar')).toBe('—')
  })

  it('returns a non-empty string for a valid Unix epoch string', () => {
    const result = formatDate('2000-06-15')
    expect(result).toBeTruthy()
    expect(result).not.toBe('—')
  })
})
