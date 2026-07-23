import { beforeEach, describe, expect, it, vi } from 'vitest'

const newContext = vi.fn()

vi.mock('@playwright/test', () => ({
  expect: Object.assign(
    (value) => ({
      toBe: (expected) => expect(value).toBe(expected),
      toBeTruthy: () => expect(value).toBeTruthy(),
    }),
    {
      poll: vi.fn(),
    },
  ),
  request: {
    newContext,
  },
}))

const { approvePairingInCloud, unbindCloudTestLicenses } = await import('../e2e/helpers.ts')

function response(status, body) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    json: vi.fn().mockResolvedValue(body),
  }
}

describe('cloud licensing cleanup helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('retries pairing after cleanup until the cloud subscription releases its prior instance', async () => {
    vi.useFakeTimers()
    vi.stubEnv('E2E_CLOUD_BUSINESS_EMAIL', 'qa@example.com')
    vi.stubEnv('E2E_CLOUD_BUSINESS_PASSWORD', 'secret')

    const cloudRequest = {
      post: vi.fn().mockResolvedValue(response(200, { ok: true })),
      patch: vi
        .fn()
        .mockResolvedValueOnce(response(409, { error: { code: 'instance_limit' } }))
        .mockResolvedValueOnce(response(409, { error: { code: 'instance_limit' } }))
        .mockResolvedValueOnce(response(409, { error: { code: 'instance_limit' } }))
        .mockResolvedValueOnce(response(200, { ok: true })),
      get: vi.fn().mockResolvedValue(response(200, { items: [{ id: 'license-a' }, { id: 'license-b' }] })),
      delete: vi
        .fn()
        .mockResolvedValueOnce(response(204, {}))
        .mockResolvedValueOnce(response(204, {})),
      dispose: vi.fn().mockResolvedValue(undefined),
    }
    newContext.mockResolvedValue(cloudRequest)

    const approval = approvePairingInCloud({
      code: 'pairing-code',
      pairingUrl: 'https://cloud.example.test/pairing/pairing-code',
    })

    await vi.advanceTimersByTimeAsync(2_000)
    await approval

    expect(newContext).toHaveBeenCalledWith({ baseURL: 'https://cloud.example.test' })
    expect(cloudRequest.post).toHaveBeenCalledWith('/api/auth/sign-in/email', {
      data: { email: 'qa@example.com', password: 'secret' },
    })
    expect(cloudRequest.get).toHaveBeenCalledWith('/api/licenses')
    expect(cloudRequest.delete).toHaveBeenNthCalledWith(1, '/api/licenses/license-a')
    expect(cloudRequest.delete).toHaveBeenNthCalledWith(2, '/api/licenses/license-b')
    expect(cloudRequest.patch).toHaveBeenCalledTimes(4)
    expect(cloudRequest.patch).toHaveBeenLastCalledWith('/api/pairings/pairing-code', {
      data: { action: 'approve' },
    })
    expect(cloudRequest.dispose).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('treats not_found license deletes as already-clean during repeat cleanup', async () => {
    const cloudRequest = {
      get: vi.fn().mockResolvedValue(response(200, { items: [{ id: 'license-a' }, { id: 'license-b' }] })),
      delete: vi
        .fn()
        .mockResolvedValueOnce(response(404, { error: { code: 'not_found' } }))
        .mockResolvedValueOnce(response(204, {})),
    }

    await expect(unbindCloudTestLicenses(cloudRequest)).resolves.toBeUndefined()

    expect(cloudRequest.get).toHaveBeenCalledWith('/api/licenses')
    expect(cloudRequest.delete).toHaveBeenNthCalledWith(1, '/api/licenses/license-a')
    expect(cloudRequest.delete).toHaveBeenNthCalledWith(2, '/api/licenses/license-b')
  })
})
