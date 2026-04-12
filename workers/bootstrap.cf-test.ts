import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from './bootstrap'

describe('[CF] Worker fetch handler', () => {
  it('throws when BETTER_AUTH_SECRET is missing', async () => {
    const request = new Request('http://localhost/api/health')
    const envWithoutSecret = { ...env, BETTER_AUTH_SECRET: '' }
    await expect(worker.fetch(request, envWithoutSecret)).rejects.toThrow(
      'BETTER_AUTH_SECRET is not configured for this deployment.',
    )
  })

  it('returns a response for a valid request', async () => {
    const request = new Request('http://localhost/api/health')
    const res = await worker.fetch(request, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('splits and trims TRUSTED_ORIGINS when provided', async () => {
    const request = new Request('http://localhost/api/health')
    const envWithOrigins = { ...env, TRUSTED_ORIGINS: ' https://a.example.com , https://b.example.com ' }
    const res = await worker.fetch(request, envWithOrigins)
    expect(res.status).toBe(200)
  })
})
