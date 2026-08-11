import { describe, expect, it, vi } from 'vitest'
import { APP_INITIALIZATION_TIMEOUT_MS, appForRequest } from './bootstrap'

describe('[CF] Worker auth initialization recovery', () => {
  it('starts a fresh initialization after an earlier request reaches its deadline', async () => {
    vi.useFakeTimers()
    try {
      const initialize = vi
        .fn()
        .mockImplementationOnce(() => new Promise(() => undefined))
        .mockResolvedValue({ auth: {}, app: { fetch: vi.fn() } })
      const keepAlive = vi.fn()
      const runtime = {
        authBySlot: new Map(),
        appBySlot: new Map(),
        appInitBySlot: new Map(),
      } as Parameters<typeof appForRequest>[0]
      const env = { BETTER_AUTH_SECRET: 'test-secret' } as Parameters<typeof appForRequest>[2]
      const request = new Request('https://recovery.example.com/api/health')

      const stuck = appForRequest(runtime, request, env, initialize, keepAlive)
      const timedOut = expect(stuck).rejects.toThrow('Worker app initialization timed out')
      expect(keepAlive).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(APP_INITIALIZATION_TIMEOUT_MS)
      await timedOut

      const recovered = appForRequest(runtime, request, env, initialize, keepAlive)

      expect(initialize).toHaveBeenCalledTimes(2)
      await expect(recovered).resolves.toEqual({ fetch: expect.any(Function) })
    } finally {
      vi.useRealTimers()
    }
  })
})
