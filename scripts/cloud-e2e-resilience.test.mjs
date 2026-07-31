import { describe, expect, it } from 'vitest'
import {
  CloudE2eCommandError,
  cloudE2eAttemptCount,
  cloudE2eEndpoints,
  cloudflaredQuickTunnelArgs,
  isRetryableQuickTunnelFailure,
} from './cloud-e2e-resilience.mjs'

describe('cloud E2E resilience', () => {
  it('provides the command error type before the runner executes', () => {
    const error = new CloudE2eCommandError('node', ['playwright', 'test'], 1, 'gateway response')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(CloudE2eCommandError)
    expect(error.message).toBe('node playwright test exited with 1')
    expect(error.output).toBe('gateway response')
  })

  it('keeps browser traffic local and reserves the tunnel for public callbacks', () => {
    expect(cloudE2eEndpoints('http://localhost:5185', 'https://callback.trycloudflare.com')).toEqual({
      browserBaseUrl: 'http://localhost:5185',
      publicBaseUrl: 'https://callback.trycloudflare.com',
    })
    expect(cloudE2eEndpoints('http://localhost:5185', null)).toEqual({
      browserBaseUrl: 'http://localhost:5185',
      publicBaseUrl: 'http://localhost:5185',
    })
  })

  it('uses HTTP/2 instead of QUIC for the Quick Tunnel transport', () => {
    expect(cloudflaredQuickTunnelArgs('http://localhost:5185')).toEqual([
      'tunnel',
      '--url',
      'http://localhost:5185',
      '--protocol',
      'http2',
      '--no-autoupdate',
    ])
  })

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
