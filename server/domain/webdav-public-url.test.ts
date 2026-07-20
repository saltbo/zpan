import { describe, expect, it } from 'vitest'
import {
  effectiveWebDavUrl,
  isPotentialWebDavPublicRequest,
  isWebDavPublicRequest,
  webDavMountPath,
  webDavPublicUrl,
} from './webdav-public-url'

describe('WebDAV public URL', () => {
  it('derives the DAV hostname from the site Public URL and matches requests by host', () => {
    expect(webDavPublicUrl(' https://example.com/path ')?.toString()).toBe('https://dav.example.com/')
    expect(isWebDavPublicRequest('http://dav.example.com/dav/workspace', 'https://example.com')).toBe(true)
    expect(webDavMountPath('https://dav.example.com/dav/workspace', 'https://example.com')).toBe('')
  })

  it('keeps the /dav mount for the primary hostname', () => {
    expect(webDavMountPath('https://example.com/dav/workspace', 'https://example.com')).toBe('/dav')
  })

  it('publishes the derived origin only after that exact origin is verified', () => {
    expect(effectiveWebDavUrl('https://example.com/api/configz', 'https://example.com', null)).toBe(
      'https://example.com/dav/',
    )
    expect(
      effectiveWebDavUrl('https://example.com/api/configz', 'https://example.com', 'https://dav.example.com'),
    ).toBe('https://dav.example.com/')
    expect(
      effectiveWebDavUrl('https://example.com/api/configz', 'https://example.com', 'https://dav.old.example.com'),
    ).toBe('https://example.com/dav/')
    expect(effectiveWebDavUrl('https://pan.example.com/api/configz', undefined, null)).toBe(
      'https://pan.example.com/dav/',
    )
  })

  it('preserves protocol and port for deployments behind a local proxy', () => {
    expect(webDavPublicUrl('http://local.test:8080')?.origin).toBe('http://dav.local.test:8080')
  })

  it('recognizes only dav-prefixed candidate requests before loading Public URL', () => {
    expect(isPotentialWebDavPublicRequest('https://dav.example.com/')).toBe(true)
    expect(isPotentialWebDavPublicRequest('https://img.dav.example.com/')).toBe(false)
  })

  it.each(['ftp://example.com', 'https://127.0.0.1', 'https://[::1]'])('does not derive from %s', (value) => {
    expect(webDavPublicUrl(value)).toBeNull()
  })
})
