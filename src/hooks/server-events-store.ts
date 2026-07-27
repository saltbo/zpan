// Cross-component registry for the single unified EventSource. Page-scoped
// consumers (e.g. the downloads page) register the query params they need on the
// connection plus a handler for their named event; useServerEvents reads this to
// build the URL and reconnect. A module store (not context) keeps it usable
// across the router Outlet boundary without provider plumbing.

export type ServerEventSubscription = {
  resourceTypes: string[]
  // Invoked with the parsed payload when the server emits an event named after the topic.
  onEvent: (data: unknown) => void
}

const subscriptions = new Map<string, ServerEventSubscription>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function setServerEventSubscription(topic: string, subscription: ServerEventSubscription) {
  subscriptions.set(topic, subscription)
  notify()
}

export function clearServerEventSubscription(topic: string) {
  if (subscriptions.delete(topic)) notify()
}

export function getServerEventSubscriptions() {
  return subscriptions
}

export function subscribeServerEventStore(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
