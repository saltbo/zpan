import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearServerEventSubscription,
  getServerEventQueryKey,
  getServerEventSubscriptions,
  setServerEventSubscription,
  subscribeServerEventStore,
} from './server-events-store'

afterEach(() => {
  // The store is a module singleton; clear any leftover subscriptions.
  for (const topic of [...getServerEventSubscriptions().keys()]) clearServerEventSubscription(topic)
})

describe('server-events-store', () => {
  it('starts with an empty merged query key', () => {
    expect(getServerEventQueryKey()).toBe('{}')
  })

  it('merges a subscription query into the key and tracks the subscription', () => {
    setServerEventSubscription('download-tasks', {
      query: { downloadTasks: '1', dtStatus: 'downloading' },
      onEvent: () => {},
    })

    expect(getServerEventQueryKey()).toBe('{"downloadTasks":"1","dtStatus":"downloading"}')
    expect(getServerEventSubscriptions().has('download-tasks')).toBe(true)
  })

  it('serializes merged query keys with stable, sorted ordering', () => {
    setServerEventSubscription('t', { query: { b: '2', a: '1' }, onEvent: () => {} })
    expect(getServerEventQueryKey()).toBe('{"a":"1","b":"2"}')
  })

  it('notifies listeners on set and clear, and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeServerEventStore(listener)

    setServerEventSubscription('a', { query: { x: '1' }, onEvent: () => {} })
    expect(listener).toHaveBeenCalledTimes(1)

    clearServerEventSubscription('a')
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setServerEventSubscription('b', { query: {}, onEvent: () => {} })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not notify when clearing an unknown topic', () => {
    const listener = vi.fn()
    subscribeServerEventStore(listener)

    clearServerEventSubscription('missing')

    expect(listener).not.toHaveBeenCalled()
  })
})
