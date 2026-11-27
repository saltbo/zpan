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

describe('request language', () => {
  it('asks Better Auth for errors in the UI language [spec: error-messages/ui-language]', async () => {
    const { default: i18n, i18nReady } = await import('@/i18n')
    await i18nReady
    await i18n.changeLanguage('zh')
    try {
      respond(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: '邮箱或密码错误' })
      const { signIn } = await import('./auth-client')
      const result = await signIn.email({ email: 'a@example.com', password: 'wrong-password' })

      expect(result.error?.message).toBe('邮箱或密码错误')
      const [input, init] = fetchMock.mock.calls[0] ?? []
      const headers = input instanceof Request ? input.headers : new Headers(init?.headers)
      expect(headers.get('Accept-Language')).toBe('zh')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
