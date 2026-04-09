import { useQuery } from '@tanstack/react-query'

export interface SiteOption {
  key: string
  value: string
  public: boolean
}

export const siteOptionsQueryKey = ['system', 'options'] as const

export function useSiteOptions() {
  const { data, isLoading, isError } = useQuery({
    queryKey: siteOptionsQueryKey,
    queryFn: async () => {
      const res = await fetch('/api/system/options', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch site options')
      return res.json() as Promise<{ items: SiteOption[]; total: number }>
    },
    staleTime: 5 * 60 * 1000,
  })

  const items = data?.items ?? []
  const optionMap = new Map(items.map((item) => [item.key, item.value]))

  return {
    siteName: optionMap.get('site_name') ?? '',
    siteDescription: optionMap.get('site_description') ?? '',
    isLoading,
    isError,
  }
}
