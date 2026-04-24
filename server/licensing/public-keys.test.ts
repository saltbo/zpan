// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PUBLIC_KEYS } from './public-keys'

describe('PUBLIC_KEYS', () => {
  it('exports a non-empty array', () => {
    expect(PUBLIC_KEYS).toBeInstanceOf(Array)
    expect(PUBLIC_KEYS.length).toBeGreaterThan(0)
  })

  it('each entry is a PASERK v4 public key', () => {
    for (const key of PUBLIC_KEYS) {
      expect(key).toMatch(/^k4\.public\./)
    }
  })
})
