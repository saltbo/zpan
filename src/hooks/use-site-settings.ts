import { useQuery } from '@tanstack/react-query'
import { getSiteSettings } from '@/lib/api'

export const siteSettingsQueryKey = ['site', 'settings'] as const

export function useSiteSettings() {
  return useQuery({
    queryKey: siteSettingsQueryKey,
    queryFn: getSiteSettings,
    staleTime: 5 * 60 * 1000,
  })
}
