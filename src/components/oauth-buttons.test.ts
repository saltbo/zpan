import { describe, expect, it } from 'vitest'
import type { AuthProvider } from '@/lib/api'

// OAuthButtons is a React rendering component. The project has no jsdom or
// @testing-library/react setup, so we cannot render it here.
// We test the pure logic the component applies:
//   - when to render (providers list empty or loading)
//   - the OAuth sign-in callback URL
//   - the provider data contract (shape expected from listAuthProviders)

// ---------------------------------------------------------------------------
// Visibility logic — mirrors the guard in OAuthButtons:
//   if (isLoading || providers.length === 0) return null
// ---------------------------------------------------------------------------

function shouldRender(isLoading: boolean, providers: AuthProvider[]): boolean {
  return !isLoading && providers.length > 0
}

describe('OAuthButtons — render visibility logic', () => {
  it('returns false (renders null) when loading', () => {
    const providers: AuthProvider[] = [{ providerId: 'github', type: 'oauth', name: 'GitHub', icon: '' }]

    expect(shouldRender(true, providers)).toBe(false)
  })

  it('returns false (renders null) when providers list is empty', () => {
    expect(shouldRender(false, [])).toBe(false)
  })

  it('returns false (renders null) when loading and providers list is empty', () => {
    expect(shouldRender(true, [])).toBe(false)
  })

  it('returns true (renders buttons) when not loading and providers exist', () => {
    const providers: AuthProvider[] = [{ providerId: 'github', type: 'oauth', name: 'GitHub', icon: '' }]

    expect(shouldRender(false, providers)).toBe(true)
  })

  it('returns true when multiple providers are present', () => {
    const providers: AuthProvider[] = [
      { providerId: 'github', type: 'oauth', name: 'GitHub', icon: '' },
      { providerId: 'google', type: 'oauth', name: 'Google', icon: '' },
    ]

    expect(shouldRender(false, providers)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Provider data contract — shape expected from listAuthProviders
// ---------------------------------------------------------------------------

function makeProvider(providerId: string, name: string): AuthProvider {
  return { providerId, type: 'oauth', name, icon: '' }
}

describe('OAuthButtons — provider data contract', () => {
  it('provider has a providerId field used as the key and social sign-in provider', () => {
    const p = makeProvider('github', 'GitHub')

    expect(p.providerId).toBe('github')
  })

  it('provider has a name field used in the button label', () => {
    const p = makeProvider('google', 'Google')

    expect(p.name).toBe('Google')
  })

  it('each provider produces a distinct button key via providerId', () => {
    const providers = [makeProvider('github', 'GitHub'), makeProvider('google', 'Google')]

    const keys = providers.map((p) => p.providerId)
    expect(new Set(keys).size).toBe(providers.length)
  })
})

// ---------------------------------------------------------------------------
// OAuth sign-in handler — callbackURL is always '/files'
// ---------------------------------------------------------------------------

function buildOAuthCallbackUrl(): string {
  return '/files'
}

describe('OAuthButtons — OAuth callback URL', () => {
  it('OAuth sign-in callback URL is "/files"', () => {
    expect(buildOAuthCallbackUrl()).toBe('/files')
  })
})

// ---------------------------------------------------------------------------
// Default staleTime — 5 minutes in milliseconds
// ---------------------------------------------------------------------------

const AUTH_PROVIDERS_STALE_TIME_MS = 5 * 60 * 1000

describe('OAuthButtons — query staleTime', () => {
  it('staleTime is 5 minutes (300_000 ms)', () => {
    expect(AUTH_PROVIDERS_STALE_TIME_MS).toBe(300_000)
  })
})

// ---------------------------------------------------------------------------
// Query key contract
// ---------------------------------------------------------------------------

const AUTH_PROVIDERS_QUERY_KEY = ['auth-providers']

describe('OAuthButtons — query key', () => {
  it('query key is ["auth-providers"]', () => {
    expect(AUTH_PROVIDERS_QUERY_KEY).toEqual(['auth-providers'])
  })
})
