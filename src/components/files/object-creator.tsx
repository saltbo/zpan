import type { ActorIdentity as ActorIdentityData, ActorProfile } from '@shared/schemas'
import type { StorageObject } from '@shared/types'
import { useQuery } from '@tanstack/react-query'
import { ActorAvatarHoverCard, ActorIdentity } from '@/components/actor-identity'
import { ApiError, getObjectCreator } from '@/lib/api'

function retryCreatorQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 3
}

function useObjectCreator(item: StorageObject, enabled: boolean): ActorProfile | ActorIdentityData | null | undefined {
  const query = useQuery({
    queryKey: ['objects', item.id, 'creator'],
    queryFn: () => getObjectCreator(item.id),
    enabled: enabled && Boolean(item.createdBy),
    staleTime: 5 * 60 * 1000,
    retry: retryCreatorQuery,
  })
  return query.data ?? item.createdBy
}

export function ObjectCreatorAvatar({ item }: { item: StorageObject }) {
  const creator = useObjectCreator(item, true)
  return <ActorAvatarHoverCard actor={creator} size="sm" />
}

export function ObjectCreatorIdentity({ item }: { item: StorageObject }) {
  const creator = useObjectCreator(item, true)
  return <ActorIdentity actor={creator} />
}
