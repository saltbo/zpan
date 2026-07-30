import { describe, expect, it } from 'vitest'
import { clearSignInRedirect, loadSignInRedirect, resolveSignInRedirect } from './sign-in-redirect'

const ORIGIN = 'https://zpan.example'

describe('resolveSignInRedirect', () => {
  it('accepts an explicit same-origin redirect', () => {
    expect(resolveSignInRedirect('?redirect=%2Fdevice%3Fuser_code%3DABCD', ORIGIN)).toBe('/device?user_code=ABCD')
  })

  it('rejects an explicit cross-origin redirect', () => {
    expect(resolveSignInRedirect('?redirect=https%3A%2F%2Fevil.example%2Fcallback', ORIGIN)).toBeNull()
  })

  it('continues a signed OAuth authorization request without reserializing it', () => {
    const query =
      'response_type=code&redirect_uri=https%3A%2F%2Fbroker.example%2Fcallback&scope=objects%3Aread+openid' +
      '&state=oauth-state&client_id=client-1&code_challenge=challenge&code_challenge_method=S256' +
      '&ba_param=client_id&ba_param=state&sig=abc%2Fdef%3D'

    expect(resolveSignInRedirect(`?${query}`, ORIGIN)).toBe(`/api/auth/oauth2/authorize?${query}`)
  })

  it('ignores an incomplete OAuth-looking query', () => {
    expect(resolveSignInRedirect('?response_type=code&client_id=client-1', ORIGIN)).toBeNull()
  })

  it('returns null for an ordinary sign-in request', () => {
    expect(resolveSignInRedirect('', ORIGIN)).toBeNull()
  })
})

describe('sign-in redirect session storage', () => {
  it('stores and restores the exact OAuth continuation within the tab session', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const query =
      '?response_type=code&redirect_uri=https%3A%2F%2Fbroker.example%2Fcallback&state=oauth-state' +
      '&client_id=client-1&code_challenge=challenge&code_challenge_method=S256&sig=abc%2Fdef%3D'
    const expected = `/api/auth/oauth2/authorize?${query.slice(1)}`

    expect(loadSignInRedirect(query, ORIGIN, storage)).toBe(expected)
    expect(loadSignInRedirect('', ORIGIN, storage)).toBe(expected)

    clearSignInRedirect(storage)
    expect(loadSignInRedirect('', ORIGIN, storage)).toBeNull()
  })

  it('removes a stored cross-origin redirect', () => {
    const values = new Map([['zpan.sign-in.redirect', 'https://evil.example/callback']])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    }

    expect(loadSignInRedirect('', ORIGIN, storage)).toBeNull()
    expect(values.size).toBe(0)
  })
})
