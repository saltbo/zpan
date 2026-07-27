import type { ProFeature } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { getLicenseEntitlements } from '@/lib/api'

export const entitlementQueryKey = ['licensing', 'entitlements'] as const
export const licenseBindingQueryKey = ['licensing', 'binding'] as const

interface EntitlementState {
  bound: boolean
  active: boolean
  edition: 'pro' | 'business' | null
  licenseId: string | null
  cloudDashboardUrl: string | null
  hasFeature: (name: ProFeature) => boolean
  isLoading: boolean
  isError: boolean
}

export function useEntitlement(): EntitlementState {
  const { data, isLoading, isError } = useQuery({
    queryKey: entitlementQueryKey,
    queryFn: getLicenseEntitlements,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })

  function hasFeature(name: ProFeature): boolean {
    return Boolean(name && data?.bound && data.active && data.features?.includes(name))
  }

  return {
    bound: data?.bound ?? false,
    active: data?.active ?? false,
    edition: data?.edition ?? null,
    licenseId: null,
    cloudDashboardUrl: null,
    hasFeature,
    isLoading,
    isError,
  }
}
