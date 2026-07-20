import { describe, expect, it } from 'vitest'
import { resolveWebDavSettingsUrl } from './webdav'

describe('resolveWebDavSettingsUrl', () => {
  it('uses the runtime option when a custom DAV URL is configured', () => {
    expect(resolveWebDavSettingsUrl('https://dav.example.com/', 'https://pan.example.com')).toBe(
      'https://dav.example.com/',
    )
  })

  it('falls back to the current-origin DAV path while options are unavailable', () => {
    expect(resolveWebDavSettingsUrl('', 'https://pan.example.com')).toBe('https://pan.example.com/dav/')
  })
})
