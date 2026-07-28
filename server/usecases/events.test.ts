import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Deps } from './deps'
import { type EventsMessage, type EventsParams, streamEvents } from './events'
import type { ResourceChange, ResourceChangeRepo } from './ports'

const POLL = 2000

function change(sequence: number): ResourceChange {
  return {
    sequence,
    scopeType: 'organization',
    scopeId: 'o1',
    resourceType: 'download_task',
    resourceId: `task-${sequence}`,
    changeType: 'upsert',
    action: 'updated',
    metadata: null,
    occurredAt: new Date(sequence * 1000),
  }
}

function makeDeps(changes: ResourceChange[] = [], oldest = 1) {
  const listAfter = vi.fn(async ({ sequence }: { sequence: number }) =>
    changes.filter((item) => item.sequence > sequence),
  )
  const latestSequence = vi.fn(async () => changes.at(-1)?.sequence ?? 0)
  const oldestSequence = vi.fn(async () => (changes.length ? oldest : null))
  const deps = {
    resourceChanges: { listAfter, latestSequence, oldestSequence } as unknown as ResourceChangeRepo,
    backgroundJobs: { activeSummary: vi.fn(async () => ({ count: 0, fingerprint: '' })) },
    notifications: { unreadCount: vi.fn(async () => 0) },
  } as unknown as Deps
  return { deps, listAfter }
}

const params = (over: Partial<EventsParams> = {}): EventsParams => ({
  scope: 'download-tasks-only',
  orgId: 'o1',
  userId: null,
  pollIntervalMs: POLL,
  heartbeatIntervalMs: 1_000_000,
  ...over,
})

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

async function run(deps: Deps, input: EventsParams, ticks = 1) {
  const abort = new AbortController()
  const events: EventsMessage[] = []
  const done = streamEvents(deps, input, abort.signal, (event) => events.push(event))
  await vi.advanceTimersByTimeAsync(0)
  for (let index = 1; index < ticks; index += 1) {
    await vi.advanceTimersByTimeAsync(input.pollIntervalMs ?? POLL)
  }
  abort.abort()
  await vi.advanceTimersByTimeAsync(0)
  await done
  return events
}

describe('streamEvents', () => {
  it('starts at the current tail for a new connection', async () => {
    const { deps } = makeDeps([change(1)])
    expect(await run(deps, params())).toEqual([])
  })

  it('resumes after Last-Event-ID and emits ordered resource changes', async () => {
    const { deps } = makeDeps([change(1), change(2), change(3)])
    const events = await run(deps, params({ afterSequence: 1 }))
    expect(events.map((event) => [event.event, event.id])).toEqual([
      ['resource-change', 2],
      ['resource-change', 3],
    ])
    expect(events[0].data).toMatchObject({ resourceType: 'download_task', resourceId: 'task-2' })
  })

  it('requests only download-task changes for an API-key stream', async () => {
    const { deps, listAfter } = makeDeps()
    await run(deps, params({ afterSequence: 0 }))
    expect(listAfter).toHaveBeenCalledWith(expect.objectContaining({ resourceTypes: ['download_task'] }))
  })

  it('emits resync when the resume cursor predates retained changes', async () => {
    const { deps } = makeDeps([change(10)], 10)
    const events = await run(deps, params({ afterSequence: 2 }))
    expect(events[0]).toEqual({ event: 'resync', data: { sequence: 10 }, id: 10 })
  })

  it('reads both organization and user feeds for a browser stream', async () => {
    const { deps, listAfter } = makeDeps()
    await run(deps, params({ scope: 'user', userId: 'u1', afterSequence: 0 }))
    expect(listAfter).toHaveBeenCalledWith(expect.objectContaining({ scopeType: 'organization', scopeId: 'o1' }))
    expect(listAfter).toHaveBeenCalledWith(expect.objectContaining({ scopeType: 'user', scopeId: 'u1' }))
  })

  it('emits a heartbeat when an idle stream reaches its interval', async () => {
    const { deps } = makeDeps()

    const events = await run(deps, params({ afterSequence: 0, heartbeatIntervalMs: 0 }))

    expect(events).toEqual([
      expect.objectContaining({
        event: 'heartbeat',
        data: expect.objectContaining({ sequence: 0 }),
        id: 0,
      }),
    ])
  })

  it('ends a connection at its maximum lifetime so EventSource can resume it', async () => {
    const { deps, listAfter } = makeDeps()
    const done = streamEvents(
      deps,
      params({ afterSequence: 0, maxDurationMs: POLL }),
      new AbortController().signal,
      vi.fn(),
    )

    await vi.advanceTimersByTimeAsync(0)
    expect(listAfter).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(POLL)
    await done
    expect(listAfter).toHaveBeenCalledTimes(1)
  })
})
