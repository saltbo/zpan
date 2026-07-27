import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef } from 'react'
import { serverEventsUrl } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import {
  clearServerEventSubscription,
  getServerEventSubscriptions,
  type ServerEventSubscription,
  setServerEventSubscription,
} from './server-events-store'

// Opens a single unified /api/events SSE connection and maps each named event
// onto the React Query cache. Always-on domains (jobs, notifications) are handled
// here; page-scoped domains register via useServerEventSubscription and are
// dispatched to their own handlers. Page subscriptions never alter or rebuild
// the network connection. Mount once, high in the authenticated tree.
export function useServerEvents() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const enabled = !!session

  useEffect(() => {
    if (!enabled) return

    const source = new EventSource(serverEventsUrl(), { withCredentials: true })

    source.addEventListener('resource-change', (event) => {
      const change = JSON.parse((event as MessageEvent<string>).data) as { resourceType: string }
      if (change.resourceType === 'background_job') {
        void queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      }
      if (change.resourceType === 'notification') {
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }
      for (const subscription of getServerEventSubscriptions().values()) {
        if (subscription.resourceTypes.includes(change.resourceType)) subscription.onEvent(change)
      }
    })

    source.addEventListener('resync', () => {
      void queryClient.invalidateQueries()
    })

    return () => source.close()
  }, [enabled, queryClient])
}

// Registers a page-scoped resource filter on the unified stream. Active only
// while mounted; the latest callback is always used via a ref.
export function useServerEventSubscription(
  topic: string,
  resourceTypes: string[],
  onEvent: ServerEventSubscription['onEvent'],
) {
  const instanceId = useId()
  const subscriptionId = `${topic}:${instanceId}`
  const resourceTypesKey = JSON.stringify(resourceTypes)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    setServerEventSubscription(subscriptionId, {
      resourceTypes: JSON.parse(resourceTypesKey),
      onEvent: (data) => onEventRef.current(data),
    })
    return () => clearServerEventSubscription(subscriptionId)
  }, [resourceTypesKey, subscriptionId])
}
