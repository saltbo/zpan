import { defaultStringifySearch, isRedirect } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { Route as authenticatedRoute } from '@/routes/_authenticated/route'
import { Route as oauthRoute } from '@/routes/oauth/route'
import { Route as checkoutRoute } from '@/routes/store/checkout'
import { loadSignInRedirect } from './sign-in-redirect'

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  getSession: vi.fn().mockResolvedValue({ session: null }),
}))

const ORIGIN = 'https://zpan.example'

const routes = [
  { name: 'authenticated', route: authenticatedRoute, pathname: '/files' },
  { name: 'OAuth', route: oauthRoute, pathname: '/oauth/consent' },
  { name: 'checkout', route: checkoutRoute, pathname: '/store/checkout' },
] as const

describe.each(routes)('$name sign-in redirect', ({ route, pathname }) => {
  it.each([
    '',
    '?sig=abc%2Fdef%3D&scope=objects%3Aread+openid&name=a%252Fb',
  ])('preserves the destination through router search serialization with query %s', async (searchStr) => {
    const storage = new Map<string, string>()
    const result = await Promise.resolve()
      .then(() => route.options.beforeLoad?.({ location: { pathname, searchStr } } as never))
      .catch((error: unknown) => error)

    expect(isRedirect(result)).toBe(true)
    if (!isRedirect(result)) throw new Error('Expected a sign-in redirect')
    expect(result.options.to).toBe('/sign-in')
    const redirectSearch: unknown = result.options.search
    if (!redirectSearch || typeof redirectSearch !== 'object') throw new Error('Expected redirect search parameters')
    const search = defaultStringifySearch(redirectSearch as Record<string, unknown>)
    expect(new URLSearchParams(search).get('redirect')).toBe(pathname + searchStr)
    expect(
      loadSignInRedirect(search, ORIGIN, {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => {
          storage.set(key, value)
        },
        removeItem: (key) => {
          storage.delete(key)
        },
      }),
    ).toBe(pathname + searchStr)
  })
})
