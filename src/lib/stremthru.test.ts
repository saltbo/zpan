import { describe, expect, it } from 'vitest'
import { mediaFusionToken, stremThruAddress } from './stremthru'

describe('StremThru connection details', () => {
  it('serves the store under /stremthru on the site origin', () => {
    expect(stremThruAddress('https://zpan.example.com')).toBe('https://zpan.example.com/stremthru')
    expect(stremThruAddress('https://zpan.example.com/')).toBe('https://zpan.example.com/stremthru')
  })

  it('composes the MediaFusion API Token from the address, the TorBox store name, and the key', () => {
    expect(mediaFusionToken('https://zpan.example.com', 'zp_key')).toBe(
      'https://zpan.example.com/stremthru|torbox:zp_key',
    )
  })
})
