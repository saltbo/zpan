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

  it('uses a configured domain instead of the derived hostname', () => {
    expect(webDavPublicUrl('https://files.example.com', 'webdisk.example.net')?.origin).toBe(
      'https://webdisk.example.net',
    )
    expect(
      isWebDavPublicRequest(
        'https://webdisk.example.net/workspace',
        'https://files.example.com',
        'webdisk.example.net',
      ),
    ).toBe(true)
    expect(isPotentialWebDavPublicRequest('https://webdisk.example.net/dav/')).toBe(true)
  })

  it.each([
    'https://dav.example.com',
    'dav.example.com:8443',
    'dav.example.com/path',
    '-dav.example.com',
  ])('rejects invalid configured domain value %s', (value) => {
    expect(() => webDavPublicUrl('https://files.example.com', value)).toThrow(
      'WebDAV domain must be a hostname without a protocol, port, or path',
    )
  })

  it('recognizes dav-prefixed hosts and rewritten /dav paths before loading settings', () => {
    expect(isPotentialWebDavPublicRequest('https://dav.example.com/')).toBe(true)
    expect(isPotentialWebDavPublicRequest('https://webdisk.example.com/dav/workspace')).toBe(true)
    expect(isPotentialWebDavPublicRequest('https://img.dav.example.com/')).toBe(false)
  })

  it.each(['ftp://example.com', 'https://127.0.0.1', 'https://[::1]'])('does not derive from %s', (value) => {
    expect(webDavPublicUrl(value)).toBeNull()
  })
})
