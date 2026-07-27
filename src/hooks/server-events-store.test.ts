import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearServerEventSubscription,
  getServerEventSubscriptions,
  setServerEventSubscription,
  subscribeServerEventStore,
} from './server-events-store'

afterEach(() => {
  // The store is a module singleton; clear any leftover subscriptions.
  for (const topic of [...getServerEventSubscriptions().keys()]) clearServerEventSubscription(topic)
})

describe('server-events-store', () => {
  it('tracks a subscription and its resource types', () => {
    setServerEventSubscription('download-tasks', {
      resourceTypes: ['download_task'],
      onEvent: () => {},
    })

    expect(getServerEventSubscriptions().has('download-tasks')).toBe(true)
    expect(getServerEventSubscriptions().get('download-tasks')?.resourceTypes).toEqual(['download_task'])
  })

  it('notifies listeners on set and clear, and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeServerEventStore(listener)

    setServerEventSubscription('a', { resourceTypes: ['object'], onEvent: () => {} })
    expect(listener).toHaveBeenCalledTimes(1)

    clearServerEventSubscription('a')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setServerEventSubscription('b', { resourceTypes: [], onEvent: () => {} })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not notify when clearing an unknown topic', () => {
    const listener = vi.fn()
    subscribeServerEventStore(listener)

    clearServerEventSubscription('missing')

    expect(listener).not.toHaveBeenCalled()
  })
})
