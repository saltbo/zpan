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
    if (!data?.bound || !data.features) return false
    if (data.expires_at != null && Date.now() > data.expires_at * 1000) return false
    return data.features.includes(name)
  }

  return {
    bound: data?.bound ?? false,
    plan: data?.plan ?? null,
    features: data?.features ?? [],
    hasFeature,
    isLoading,
    isError,
  }
}
