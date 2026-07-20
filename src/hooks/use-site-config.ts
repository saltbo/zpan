import { useQuery } from '@tanstack/react-query'
import { getSiteConfig } from '@/lib/api'

export const siteConfigQueryKey = ['site', 'config'] as const

export function useSiteConfig() {
  return useQuery({
    queryKey: siteConfigQueryKey,
    queryFn: getSiteConfig,
    staleTime: 5 * 60 * 1000,
  })
}
