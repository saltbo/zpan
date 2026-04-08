import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'

export interface SiteOptions {
  'site.name': string
  'site.description': string
}

const DEFAULTS: SiteOptions = {
  'site.name': 'ZPan',
  'site.description': '',
}

export const siteOptionsQueryKey = ['system', 'options'] as const

export function useSiteOptions() {
  return useQuery({
    queryKey: siteOptionsQueryKey,
    queryFn: async (): Promise<SiteOptions> => {
      const res = await fetch('/api/system/options', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load site options')
      const data = (await res.json()) as Partial<SiteOptions>
      return { ...DEFAULTS, ...data }
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULTS,
  })
}

export function useSiteName(): string {
  const { data } = useSiteOptions()
  return data?.['site.name'] || DEFAULTS['site.name']
}

export function useDocumentTitle() {
  const siteName = useSiteName()
  useEffect(() => {
    document.title = siteName
  }, [siteName])
}
