import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp } from '../test/setup.js'
import { reportInstanceTelemetry } from '../usecases/site/instance-telemetry'

vi.mock('../usecases/site/instance-telemetry', () => ({
  INSTANCE_TELEMETRY_CRON: '0 */12 * * *',
  reportInstanceTelemetry: vi.fn(),
}))

describe('POST /api/internal/instance-telemetry/report', () => {
  beforeEach(() => {
    vi.mocked(reportInstanceTelemetry).mockReset()
    vi.mocked(reportInstanceTelemetry).mockResolvedValue({ reported: true })
  })

  it('returns 404 when the internal token is not configured', async () => {
    const { app } = await createTestApp()

    const res = await app.request('/api/internal/instance-telemetry/report', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(404)
    expect(reportInstanceTelemetry).not.toHaveBeenCalled()
  })

  it('rejects requests with the wrong token', async () => {
    const { app } = await createTestApp({ ZPAN_INTERNAL_API_TOKEN: 'test-token' })

    const res = await app.request('/api/internal/instance-telemetry/report', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
    })

    expect(res.status).toBe(401)
    expect(reportInstanceTelemetry).not.toHaveBeenCalled()
  })

  it('reports telemetry with the configured internal token', async () => {
    const { app, deps } = await createTestApp({
      ZPAN_INTERNAL_API_TOKEN: 'test-token',
    })

    const res = await app.request('/api/internal/instance-telemetry/report', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ reported: true })
    expect(reportInstanceTelemetry).toHaveBeenCalledWith(deps, {
      config: {
        allowIp: true,
      },
      cron: '0 */12 * * *',
      trigger: 'deploy',
      runtime: expect.objectContaining({
        runtime: 'node',
        platform: 'node',
      }),
    })
  })
})
