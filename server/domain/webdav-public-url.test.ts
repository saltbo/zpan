import { describe, expect, it } from 'vitest'
import { effectiveWebDavUrl, isWebDavPublicRequest, parseWebDavPublicUrl, webDavMountPath } from './webdav-public-url'

describe('WebDAV public URL', () => {
  it('normalizes an origin and matches requests by host', () => {
    expect(parseWebDavPublicUrl(' https://dav.example.com/ ')?.toString()).toBe('https://dav.example.com/')
    expect(isWebDavPublicRequest('http://dav.example.com/dav/workspace', 'https://dav.example.com')).toBe(true)
    expect(webDavMountPath('https://dav.example.com/dav/workspace', 'https://dav.example.com')).toBe('')
  })

  it('keeps the /dav mount for the primary hostname', () => {
    expect(webDavMountPath('https://pan.example.com/dav/workspace', 'https://dav.example.com')).toBe('/dav')
  })

  it('returns the configured origin or the request-origin path fallback', () => {
    expect(effectiveWebDavUrl('https://pan.example.com/api/site/options', 'https://dav.example.com')).toBe(
      'https://dav.example.com/',
    )
    expect(effectiveWebDavUrl('https://pan.example.com/api/site/options', undefined)).toBe(
      'https://pan.example.com/dav/',
    )
  })

  it('accepts http for deployments behind a local proxy', () => {
    expect(parseWebDavPublicUrl('http://dav.local:8080')?.origin).toBe('http://dav.local:8080')
  })

  it.each([
    'ftp://dav.example.com',
    'https://user@example.com',
    'https://dav.example.com/path',
    'https://dav.example.com?x=1',
    'https://dav.example.com#fragment',
  ])('rejects invalid configuration %s', (value) => {
    expect(() => parseWebDavPublicUrl(value)).toThrow('WEBDAV_PUBLIC_URL')
  })
})
