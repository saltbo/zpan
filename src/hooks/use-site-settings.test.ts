import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSiteSettings } from '@/lib/api'
import { siteSettingsQueryKey, useSiteSettings } from './use-site-settings'

const useQueryMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }))
vi.mock('@/lib/api', () => ({ getSiteSettings: vi.fn() }))

beforeEach(() => useQueryMock.mockReset())

describe('useSiteSettings', () => {
  it('uses one stable admin settings query', () => {
    const query = { data: undefined, isLoading: true }
    useQueryMock.mockReturnValue(query)

    expect(useSiteSettings()).toBe(query)
    expect(useQueryMock).toHaveBeenCalledWith({
      queryKey: siteSettingsQueryKey,
      queryFn: getSiteSettings,
      staleTime: 5 * 60 * 1000,
    })
    expect(siteSettingsQueryKey).toEqual(['site', 'settings'])
  })
})
