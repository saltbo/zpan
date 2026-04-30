import type { ProFeature } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { getLicensingStatus } from '@/lib/api'

export const entitlementQueryKey = ['licensing', 'status'] as const

export function useEntitlement() {
  const { data, isLoading, isError } = useQuery({
    queryKey: entitlementQueryKey,
    queryFn: getLicensingStatus,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })

  function hasFeature(name: ProFeature): boolean {
    return Boolean(name && data?.bound && data.active)
  }

  return {
    bound: data?.bound ?? false,
    active: data?.active ?? false,
    edition: data?.edition ?? null,
    hasFeature,
    isLoading,
    isError,
  }
}
