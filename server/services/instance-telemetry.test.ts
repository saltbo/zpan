import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getOrCreateInstanceId } from '../licensing/instance-id'
import type { Database } from '../platform/interface'
import { INSTANCE_TELEMETRY_CRON, INSTANCE_TELEMETRY_EVENT, reportInstanceTelemetry } from './instance-telemetry'

vi.mock('../licensing/instance-id', () => ({
  getOrCreateInstanceId: vi.fn(),
}))

describe('instance telemetry', () => {
  beforeEach(() => {
    vi.mocked(getOrCreateInstanceId).mockReset()
  })

  it('does not call PostHog when config is disabled', async () => {
    const fetchFn = vi.fn()

    const result = await reportInstanceTelemetry({
      db: {} as Database,
      config: { posthogHost: 'https://e.zpan.space' },
      cron: INSTANCE_TELEMETRY_CRON,
      runtime: { target: 'cloudflare-worker' },
      fetchFn,
    })

    expect(result).toEqual({ reported: false, reason: 'disabled' })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(getOrCreateInstanceId).not.toHaveBeenCalled()
  })

  it('captures the expected PostHog event when config is enabled', async () => {
    vi.mocked(getOrCreateInstanceId).mockResolvedValue('inst-1')
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))

    const result = await reportInstanceTelemetry({
      db: {} as Database,
      config: {
        posthogHost: 'https://e.zpan.space/',
        posthogProjectToken: 'ph-token',
        configuredInstanceId: 'configured-inst',
      },
      cron: INSTANCE_TELEMETRY_CRON,
      runtime: {
        target: 'node/docker',
        hostname: 'zpan.example',
        osPlatform: 'linux',
        osArch: 'arm64',
        osRelease: '6.8.0',
      },
      now: new Date('2026-06-08T12:00:00.000Z'),
      fetchFn,
    })

    expect(result).toEqual({ reported: true })
    expect(getOrCreateInstanceId).toHaveBeenCalledWith({}, 'configured-inst')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('https://e.zpan.space/capture/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: expect.any(String),
    })

    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body).toMatchObject({
      api_key: 'ph-token',
      event: INSTANCE_TELEMETRY_EVENT,
      distinct_id: 'inst-1',
      timestamp: '2026-06-08T12:00:00.000Z',
      properties: {
        instance_id: 'inst-1',
        app_version: '0.0.1',
        runtime_target: 'node/docker',
        hostname: 'zpan.example',
        os_platform: 'linux',
        os_arch: 'arm64',
        os_release: '6.8.0',
        cron: INSTANCE_TELEMETRY_CRON,
        report_interval: '12h',
        reported_at: '2026-06-08T12:00:00.000Z',
      },
    })
  })
})
