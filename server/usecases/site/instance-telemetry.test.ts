import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstanceRepo, SystemOptionsRepo } from '../ports'
import {
  INSTANCE_TELEMETRY_CRON,
  INSTANCE_TELEMETRY_EVENT,
  INSTANCE_TELEMETRY_POSTHOG_HOST,
  INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN,
  type InstanceTelemetryDeps,
  reportInstanceTelemetry,
} from './instance-telemetry'

const posthogMocks = vi.hoisted(() => {
  const captureImmediateMock = vi.fn()
  const shutdownMock = vi.fn()
  const PostHog = vi.fn(
    class {
      captureImmediate = captureImmediateMock
      shutdown = shutdownMock
    },
  )
  return { PostHog, captureImmediate: captureImmediateMock, shutdown: shutdownMock }
})

vi.mock('posthog-node', () => ({
  PostHog: posthogMocks.PostHog,
}))

const getOrCreateInstanceId = vi.fn()
const getInstanceDisplayName = vi.fn()
const getValue = vi.fn()

function makeDeps(): InstanceTelemetryDeps {
  return {
    instance: { getOrCreateInstanceId, getInstanceDisplayName } as unknown as InstanceRepo,
    systemOptions: { getValue } as unknown as SystemOptionsRepo,
  }
}

describe('instance telemetry', () => {
  beforeEach(() => {
    getOrCreateInstanceId.mockReset()
    getInstanceDisplayName.mockReset()
    getValue.mockReset()
    getValue.mockResolvedValue(null)
    posthogMocks.PostHog.mockClear()
    posthogMocks.captureImmediate.mockReset()
    posthogMocks.shutdown.mockReset()
    posthogMocks.captureImmediate.mockResolvedValue(undefined)
    posthogMocks.shutdown.mockResolvedValue(undefined)
    getInstanceDisplayName.mockResolvedValue('Test Instance')
  })

  it('does not call the telemetry endpoint when PostHog project token is disabled', async () => {
    const result = await reportInstanceTelemetry(makeDeps(), {
      config: { posthogProjectToken: '' },
      cron: INSTANCE_TELEMETRY_CRON,
      runtime: { runtime: 'workerd', platform: 'cloudflare-workers' },
    })

    expect(result).toEqual({ reported: false, reason: 'disabled' })
    expect(posthogMocks.PostHog).not.toHaveBeenCalled()
    expect(getOrCreateInstanceId).not.toHaveBeenCalled()
    expect(getInstanceDisplayName).not.toHaveBeenCalled()
  })

  it('captures the expected telemetry event with built-in PostHog host and project token', async () => {
    getOrCreateInstanceId.mockResolvedValue('inst-1')

    const result = await reportInstanceTelemetry(makeDeps(), {
      config: {
        siteUrl: 'https://zpan.example.com/path',
      },
      cron: INSTANCE_TELEMETRY_CRON,
      runtime: {
        runtime: 'node',
        platform: 'docker',
        osPlatform: 'linux',
        osArch: 'arm64',
        osRelease: '6.8.0',
        nodeVersion: 'v24.0.0',
      },
      now: new Date('2026-06-08T12:00:00.000Z'),
    })

    expect(result).toEqual({ reported: true })
    expect(getOrCreateInstanceId).toHaveBeenCalled()
    expect(getInstanceDisplayName).toHaveBeenCalled()
    expect(posthogMocks.PostHog).toHaveBeenCalledWith(INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN, {
      host: INSTANCE_TELEMETRY_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      disableCompression: true,
      disableGeoip: false,
    })
    expect(posthogMocks.captureImmediate).toHaveBeenCalledTimes(1)
    expect(posthogMocks.captureImmediate).toHaveBeenCalledWith({
      event: INSTANCE_TELEMETRY_EVENT,
      distinctId: 'inst-1',
      disableGeoip: false,
      timestamp: new Date('2026-06-08T12:00:00.000Z'),
      properties: {
        instance: {
          id: 'inst-1',
          name: 'Test Instance',
          url: 'https://zpan.example.com',
          version: 'test-version',
          runtime: 'node',
          platform: 'docker',
          server: {
            os: {
              platform: 'linux',
              arch: 'arm64',
              release: '6.8.0',
            },
          },
          node: {
            version: 'v24.0.0',
          },
        },
        report_trigger: 'scheduled',
        report_interval: '12h',
        report_schedule: INSTANCE_TELEMETRY_CRON,
        reported_at: '2026-06-08T12:00:00.000Z',
        $current_url: 'https://zpan.example.com',
        $set: {
          instance: {
            id: 'inst-1',
            name: 'Test Instance',
            url: 'https://zpan.example.com',
            version: 'test-version',
            runtime: 'node',
            platform: 'docker',
            server: {
              os: {
                platform: 'linux',
                arch: 'arm64',
                release: '6.8.0',
              },
            },
            node: {
              version: 'v24.0.0',
            },
          },
          $current_url: 'https://zpan.example.com',
        },
        $set_once: {
          initialInstance: {
            id: 'inst-1',
            name: 'Test Instance',
            url: 'https://zpan.example.com',
            version: 'test-version',
            runtime: 'node',
            platform: 'docker',
            server: {
              os: {
                platform: 'linux',
                arch: 'arm64',
                release: '6.8.0',
              },
            },
            node: {
              version: 'v24.0.0',
            },
          },
          initialReportedAt: '2026-06-08T12:00:00.000Z',
        },
      },
    })
    expect(posthogMocks.shutdown).toHaveBeenCalledTimes(1)
  })

  it('disables GeoIP when IP reporting is explicitly disabled', async () => {
    getOrCreateInstanceId.mockResolvedValue('inst-1')

    await reportInstanceTelemetry(makeDeps(), {
      config: {
        siteUrl: 'https://zpan.example.com',
        allowIp: false,
      },
      cron: INSTANCE_TELEMETRY_CRON,
      runtime: {
        runtime: 'workerd',
        platform: 'cloudflare-workers',
      },
      now: new Date('2026-06-08T12:00:00.000Z'),
    })

    expect(posthogMocks.PostHog).toHaveBeenCalledWith(INSTANCE_TELEMETRY_POSTHOG_PROJECT_TOKEN, {
      host: INSTANCE_TELEMETRY_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
      disableCompression: true,
      disableGeoip: true,
    })
    expect(posthogMocks.captureImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        disableGeoip: true,
      }),
    )
  })

  it('falls back to the stored site public origin when no siteUrl is configured', async () => {
    getOrCreateInstanceId.mockResolvedValue('inst-1')
    getValue.mockResolvedValue('https://stored.example.com')

    await reportInstanceTelemetry(makeDeps(), {
      config: {},
      cron: INSTANCE_TELEMETRY_CRON,
      runtime: { runtime: 'workerd', platform: 'cloudflare-workers' },
      now: new Date('2026-06-08T12:00:00.000Z'),
    })

    expect(getValue).toHaveBeenCalled()
    expect(posthogMocks.captureImmediate).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          $current_url: 'https://stored.example.com',
        }),
      }),
    )
  })
})
