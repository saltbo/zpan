import { useQuery } from '@tanstack/react-query'

export interface SiteOptions {
  'site.name': string
  'site.description': string
  [key: string]: string
}

const DEFAULT_SITE_OPTIONS: SiteOptions = {
  'site.name': 'ZPan',
  'site.description': '',
}

export const siteOptionsQueryKey = ['system', 'options'] as const

async function fetchSiteOptions(): Promise<SiteOptions> {
  const res = await fetch('/api/system/options', { credentials: 'include' })
  if (!res.ok) {
    throw new Error('Failed to load site options')
  }
  const body = (await res.json()) as Record<string, string> | SiteOptions
  return { ...DEFAULT_SITE_OPTIONS, ...body }
}

export function useSiteOptions() {
  return useQuery({
    queryKey: siteOptionsQueryKey,
    queryFn: fetchSiteOptions,
    staleTime: 5 * 60 * 1000,
    placeholderData: DEFAULT_SITE_OPTIONS,
  })
}

export function useSiteName(): string {
  const { data } = useSiteOptions()
  return data?.['site.name'] || DEFAULT_SITE_OPTIONS['site.name']
}
