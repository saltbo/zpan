import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSiteConfig } from '@/lib/api'
import { siteConfigQueryKey, useSiteConfig } from './use-site-config'

const useQueryMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }))
vi.mock('@/lib/api', () => ({ getSiteConfig: vi.fn() }))

beforeEach(() => useQueryMock.mockReset())

describe('useSiteConfig', () => {
  it('uses one stable public configuration query', () => {
    const query = { data: undefined, isLoading: true }
    useQueryMock.mockReturnValue(query)

    expect(useSiteConfig()).toBe(query)
    expect(useQueryMock).toHaveBeenCalledWith({
      queryKey: siteConfigQueryKey,
      queryFn: getSiteConfig,
      staleTime: 5 * 60 * 1000,
    })
    expect(siteConfigQueryKey).toEqual(['site', 'config'])
  })
})
