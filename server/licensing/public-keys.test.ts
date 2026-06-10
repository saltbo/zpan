// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { getTrustedPublicKeys, PUBLIC_KEYS, registerEnvPublicKeys } from './public-keys'

describe('public keys', () => {
  afterEach(() => {
    registerEnvPublicKeys(undefined)
  })

  it('trusts the builtin staging + production keys by default', () => {
    const trusted = getTrustedPublicKeys()
    expect(trusted.length).toBeGreaterThan(0)
    for (const key of trusted) {
      expect(key).toMatch(/^k4\.public\./)
    }
  })

  it('does not bake any dev key into the build (runtime layer starts empty)', () => {
    registerEnvPublicKeys(undefined)
    expect(PUBLIC_KEYS).toEqual([])
  })

  it('registers env-configured keys and merges them with the builtins', () => {
    const builtinCount = getTrustedPublicKeys().length
    registerEnvPublicKeys('k4.public.aaa, k4.public.bbb')
    expect(PUBLIC_KEYS).toEqual(['k4.public.aaa', 'k4.public.bbb'])
    expect(getTrustedPublicKeys()).toHaveLength(builtinCount + 2)
  })

  it('parses whitespace- or comma-separated keys and ignores malformed entries', () => {
    registerEnvPublicKeys('k4.public.one\n  k4.public.two , not-a-key')
    expect(PUBLIC_KEYS).toEqual(['k4.public.one', 'k4.public.two'])
  })

  it('clears the runtime layer when re-registered with no value', () => {
    registerEnvPublicKeys('k4.public.one')
    expect(PUBLIC_KEYS).toHaveLength(1)
    registerEnvPublicKeys(undefined)
    expect(PUBLIC_KEYS).toEqual([])
  })
})
