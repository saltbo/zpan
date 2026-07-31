import { describe, expect, it } from 'vitest'
import { cloudE2eAttemptCount, isRetryableQuickTunnelFailure } from './cloud-e2e-resilience.mjs'

describe('cloud E2E resilience', () => {
  it('retries a Cloudflare Quick Tunnel gateway page', () => {
    expect(
      isRetryableQuickTunnelFailure({
        commandOutput: '<title>trycloudflare.com | 502: Bad gateway</title>',
        tunnelOutput: '',
      }),
    ).toBe(true)
  })

  it('retries a client 502 corroborated by a canceled Quick Tunnel request', () => {
    expect(
      isRetryableQuickTunnelFailure({
        commandOutput: 'expected 200, got 502',
        tunnelOutput:
          'Request failed error="context canceled" dest=https://fresh-tunnel.trycloudflare.com/api/events',
      }),
    ).toBe(true)
  })

  it('does not retry application failures or assertions', () => {
    expect(
      isRetryableQuickTunnelFailure({
        commandOutput: 'expected 200, got 500: checkout failed',
        tunnelOutput: '',
      }),
    ).toBe(false)
    expect(
      isRetryableQuickTunnelFailure({
        commandOutput: 'expect(received).toEqual(expected)',
        tunnelOutput:
          'Incoming request ended abruptly: context canceled dest=https://fresh-tunnel.trycloudflare.com/api/events',
      }),
    ).toBe(false)
  })

  it('uses two attempts by default and validates overrides', () => {
    expect(cloudE2eAttemptCount()).toBe(2)
    expect(cloudE2eAttemptCount('3')).toBe(3)
    expect(() => cloudE2eAttemptCount('0')).toThrow('must be a positive integer')
    expect(() => cloudE2eAttemptCount('nope')).toThrow('must be a positive integer')
  })
})
