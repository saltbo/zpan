import { describe, expect, it } from 'vitest'
import { mimeToExt } from './mime-utils'

describe('mimeToExt', () => {
  it('maps known image MIME types to extensions', () => {
    expect(mimeToExt('image/png')).toBe('png')
    expect(mimeToExt('image/jpeg')).toBe('jpg')
    expect(mimeToExt('image/gif')).toBe('gif')
    expect(mimeToExt('image/webp')).toBe('webp')
    expect(mimeToExt('image/svg+xml')).toBe('svg')
    expect(mimeToExt('image/x-icon')).toBe('ico')
    expect(mimeToExt('image/vnd.microsoft.icon')).toBe('ico')
  })

  it('falls back to bin for unknown types', () => {
    expect(mimeToExt('application/octet-stream')).toBe('bin')
    expect(mimeToExt('')).toBe('bin')
  })
})
