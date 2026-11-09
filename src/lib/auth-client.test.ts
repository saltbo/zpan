import { beforeEach, describe, expect, it, vi } from 'vitest'

// better-auth's client binds fetch when the module is created, so the stub must exist before import.
const fetchMock = vi.hoisted(() => {
  const mock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
  globalThis.fetch = mock as unknown as typeof fetch
  return mock
})

const { verifyDeviceCode } = await import('./auth-client')

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

function requestedUrl(): URL {
  const [input] = fetchMock.mock.calls[0] ?? []
  return new URL(input instanceof Request ? input.url : String(input))
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('verifyDeviceCode', () => {
  it('GETs /device with the user code and returns the disclosed client and scope', async () => {
    respond(200, { user_code: 'ABCDEFGH', status: 'pending', client_id: 'zpan-cli', scope: 'downloader:register' })

    await expect(verifyDeviceCode('ABCD-EFGH')).resolves.toEqual({
      user_code: 'ABCDEFGH',
      status: 'pending',
      client_id: 'zpan-cli',
      scope: 'downloader:register',
    })
    expect(requestedUrl().pathname).toBe('/api/auth/device')
    expect(requestedUrl().searchParams.get('user_code')).toBe('ABCD-EFGH')
    const [input, init] = fetchMock.mock.calls[0] ?? []
    expect(input instanceof Request ? input.method : (init?.method ?? 'GET')).toBe('GET')
  })

  it('throws the server error message', async () => {
    respond(400, { message: 'Invalid user code' })

    await expect(verifyDeviceCode('NOPE')).rejects.toThrow('Invalid user code')
  })
})
