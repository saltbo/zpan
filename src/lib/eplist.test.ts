import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.unstubAllGlobals()
})

describe('eplist client', () => {
  it('loads providers and endpoints from the eplist raw YAML files', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/index.yml')) {
        return new Response(
          ['version: v1', 'providers:', '  - slug: tigris', '    display-name: Tigris', '    file: tigris.yml'].join(
            '\n',
          ),
        )
      }
      if (url.endsWith('/tigris.yml')) {
        return new Response(
          [
            'version: v1',
            'metameta:',
            '  name: tigris',
            'endpoints:',
            '  - region: auto',
            '    endpoint: t3.storage.dev',
          ].join('\n'),
        )
      }
      return new Response('', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { eplistEndpointUrl, findEplistProvider, listEplistEndpoints, listEplistProviders } = await import('./eplist')

    const providers = await listEplistProviders()
    const provider = findEplistProvider(providers, 'Tigris')

    expect(provider).toMatchObject({ slug: 'tigris', displayName: 'Tigris', file: 'tigris.yml' })
    await expect(listEplistEndpoints(provider!)).resolves.toEqual([{ region: 'auto', endpoint: 't3.storage.dev' }])
    expect(eplistEndpointUrl('t3.storage.dev')).toBe('https://t3.storage.dev')
  })
})
