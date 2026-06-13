import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { serverEventsUrl } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import {
  clearServerEventSubscription,
  getServerEventQueryKey,
  getServerEventSubscriptions,
  type ServerEventSubscription,
  setServerEventSubscription,
  subscribeServerEventStore,
} from './server-events-store'

// Opens a single unified /api/events SSE connection and maps each named event
// onto the React Query cache. Always-on domains (jobs, notifications) are handled
// here; page-scoped domains register via useServerEventSubscription and are
// dispatched to their own handlers. The connection rebuilds whenever the merged
// subscription query changes, so the server only polls what some open page needs.
// Mount once, high in the authenticated tree.
export function useServerEvents() {
  const queryClient = useQueryClient()
  const { data: session } = useSession()
  const enabled = !!session
  const queryKey = useSyncExternalStore(subscribeServerEventStore, getServerEventQueryKey, getServerEventQueryKey)

  useEffect(() => {
    if (!enabled) return

    const subscriptions = getServerEventSubscriptions()
    const source = new EventSource(serverEventsUrl(JSON.parse(queryKey)), { withCredentials: true })

    source.addEventListener('jobs', (event) => {
      const { activeCount } = JSON.parse((event as MessageEvent<string>).data) as { activeCount: number }
      queryClient.setQueryData(['background-jobs', 'active-count'], activeCount)
      queryClient.invalidateQueries({
        queryKey: ['background-jobs'],
        predicate: (q) => q.queryKey[1] !== 'active-count',
      })
    })

    source.addEventListener('notifications', (event) => {
      const { unreadCount } = JSON.parse((event as MessageEvent<string>).data) as { unreadCount: number }
      queryClient.setQueryData(['notifications', 'unread-count'], { count: unreadCount })
      queryClient.invalidateQueries({
        queryKey: ['notifications'],
        predicate: (q) => q.queryKey[1] !== 'unread-count',
      })
    })

    for (const [topic, subscription] of subscriptions) {
      source.addEventListener(topic, (event) => {
        subscription.onEvent(JSON.parse((event as MessageEvent<string>).data))
      })
    }

    return () => source.close()
  }, [enabled, queryClient, queryKey])
}

// Registers a page-scoped subscription on the unified stream: `query` is merged
// into the EventSource URL (telling the server to poll this domain) and `onEvent`
// receives payloads for the event named `topic`. Active only while mounted; the
// latest onEvent is always used via a ref, so only query changes force a reconnect.
export function useServerEventSubscription(
  topic: string,
  query: Record<string, string>,
  onEvent: ServerEventSubscription['onEvent'],
) {
  const queryString = JSON.stringify(query)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    setServerEventSubscription(topic, {
      query: JSON.parse(queryString),
      onEvent: (data) => onEventRef.current(data),
    })
    return () => clearServerEventSubscription(topic)
  }, [topic, queryString])
}
