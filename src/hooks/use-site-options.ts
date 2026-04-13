import { SignupMode } from '@shared/constants'
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
    siteName: optionMap.get('site_name') ?? '',
    siteDescription: optionMap.get('site_description') ?? '',
    defaultOrgQuota: Number(optionMap.get('default_org_quota') ?? '0'),
    authSignupMode: (optionMap.get('auth_signup_mode') as SignupMode) ?? SignupMode.OPEN,
    isLoading,
    isError,
  }
}
