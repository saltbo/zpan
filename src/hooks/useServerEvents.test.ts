import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearServerEventSubscription,
  getServerEventSubscriptions,
  setServerEventSubscription,
} from './server-events-store'
import { useServerEventSubscription, useServerEvents } from './useServerEvents'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  session: { data: { user: { id: 'user-1' } } } as { data: unknown },
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('@/lib/api', () => ({
  serverEventsUrl: () => '/api/events',
}))

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mocks.session,
}))

class EventSourceStub {
  static instances: EventSourceStub[] = []

  readonly listeners = new Map<string, EventListener>()
  readonly close = vi.fn()

  constructor(
    readonly url: string,
    readonly options: EventSourceInit,
  ) {
    EventSourceStub.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener)
  }

  emit(type: string, data?: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent)
  }
}

beforeEach(() => {
  mocks.invalidateQueries.mockReset()
  mocks.session = { data: { user: { id: 'user-1' } } }
  EventSourceStub.instances = []
  vi.stubGlobal('EventSource', EventSourceStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const id of [...getServerEventSubscriptions().keys()]) clearServerEventSubscription(id)
})

describe('useServerEvents', () => {
  it('keeps the global connection closed without a session', () => {
    mocks.session = { data: null }

    renderHook(() => useServerEvents())

    expect(EventSourceStub.instances).toHaveLength(0)
  })

  it('dispatches global and page-scoped events through one connection', () => {
    const onObjectChange = vi.fn()
    setServerEventSubscription('objects:test', {
      resourceTypes: ['object'],
      onEvent: onObjectChange,
    })
    const { unmount } = renderHook(() => useServerEvents())
    const [source] = EventSourceStub.instances

    expect(source).toMatchObject({
      url: '/api/events',
      options: { withCredentials: true },
    })

    act(() => {
      source?.emit('resource-change', { resourceType: 'background_job' })
      source?.emit('resource-change', { resourceType: 'notification' })
      source?.emit('resource-change', { resourceType: 'object', resourceId: 'object-1' })
      source?.emit('resync')
    })

    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['background-jobs'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith()
    expect(onObjectChange).toHaveBeenCalledWith({ resourceType: 'object', resourceId: 'object-1' })

    unmount()
    expect(source?.close).toHaveBeenCalledOnce()
  })
})

describe('useServerEventSubscription', () => {
  it('registers the latest callback and removes it on unmount', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ onEvent }) => useServerEventSubscription('downloads', ['download_task'], onEvent),
      { initialProps: { onEvent: first } },
    )
    const [[subscriptionId, subscription]] = [...getServerEventSubscriptions()]

    expect(subscriptionId).toMatch(/^downloads:/)
    expect(subscription?.resourceTypes).toEqual(['download_task'])

    rerender({ onEvent: second })
    act(() => subscription?.onEvent({ resourceType: 'download_task' }))

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ resourceType: 'download_task' })

    unmount()
    expect(getServerEventSubscriptions().has(subscriptionId ?? '')).toBe(false)
  })
})
