import { DEFAULT_SITE_DESCRIPTION, DEFAULT_SITE_NAME, SignupMode } from '@shared/constants'
import { useQuery } from '@tanstack/react-query'
import { listSystemOptions, type SiteOption } from '@/lib/api'

export type { SiteOption }

export const siteOptionsQueryKey = ['system', 'options'] as const

export function useSiteOptions() {
  const { data, isLoading, isError } = useQuery({
    queryKey: siteOptionsQueryKey,
    queryFn: listSystemOptions,
    staleTime: 5 * 60 * 1000,
  })

  const items = data?.items ?? []
  const optionMap = new Map(items.map((item) => [item.key, item.value]))

  return {
    siteName: optionMap.get('site_name') ?? DEFAULT_SITE_NAME,
    siteDescription: optionMap.get('site_description') ?? DEFAULT_SITE_DESCRIPTION,
    defaultOrgQuota: Number(optionMap.get('default_org_quota') ?? '0'),
    authSignupMode: (optionMap.get('auth_signup_mode') as SignupMode) ?? SignupMode.OPEN,
    isLoading,
    isError,
  }
}
