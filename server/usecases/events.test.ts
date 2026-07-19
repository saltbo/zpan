import type { BackgroundJob, DownloadTask } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Platform } from '../platform/interface'
import type { Deps } from './deps'
import { listDownloadTasks } from './downloads/downloads'
import { type EventsMessage, type EventsParams, streamEvents } from './events'
import type { BackgroundJobRepo, NotificationRepo } from './ports'

// listDownloadTasks pulls in the whole downloader/upload-token machinery — out
// of scope for this poll-loop unit test. Mock it so each case feeds a chosen
// download-task list directly; the dedup logic under test then runs against it.
vi.mock('./downloads/downloads', () => ({ listDownloadTasks: vi.fn() }))

const platform = {} as Platform

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob =>
  ({ id: 'j1', status: 'running', updatedAt: 't0', progress: { processedBytes: 0 }, ...over }) as BackgroundJob

const task = (id: string, updatedAt: string): DownloadTask => ({ id, status: { updatedAt } }) as unknown as DownloadTask

// Build a fake deps whose three subscribed ports return canned values. Each port
// method is a fresh spy so a test can assert call counts and swap return values.
// `jobs` supplies the "running" list (queued is always empty here).
function makeDeps(over: { jobs?: () => { items: BackgroundJob[]; total: number }; unread?: () => number } = {}) {
  const list = vi.fn(async (_orgId: string, opts: { status?: string }) =>
    opts.status === 'queued' ? { items: [], total: 0 } : (over.jobs?.() ?? { items: [], total: 0 }),
  )
  const unreadCount = vi.fn(async () => over.unread?.() ?? 0)
  const deps = {
    backgroundJobs: { list } as unknown as BackgroundJobRepo,
    notifications: { unreadCount } as unknown as NotificationRepo,
    downloadTasks: {} as Deps['downloadTasks'],
  } as Deps
  return { deps, list, unreadCount }
}

const POLL = 2000

const baseParams = (over: Partial<EventsParams> = {}): EventsParams => ({
  platform,
  scope: 'user',
  orgId: 'o1',
  userId: 'u1',
  wantsDownloadTasks: false,
  pollIntervalMs: POLL,
  heartbeatIntervalMs: 1_000_000, // effectively off unless a test lowers it
  ...over,
})

// Fake timers make the poll loop deterministic: advanceTimersByTimeAsync flushes
// both the inter-tick setTimeout and the awaited port microtasks. Advancing by
// `(ticks - 1) * POLL` lets the loop run exactly `ticks` iterations (the first
// runs synchronously on start, each subsequent one after one POLL delay).
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

async function run(
  deps: Deps,
  params: EventsParams,
  ticks: number,
): Promise<{ events: EventsMessage[]; controller: AbortController; done: Promise<void> }> {
  const controller = new AbortController()
  const events: EventsMessage[] = []
  const done = streamEvents(deps, params, controller.signal, (m) => events.push(m))
  await vi.advanceTimersByTimeAsync(0) // let the first (synchronous) tick settle
  for (let i = 1; i < ticks; i += 1) await vi.advanceTimersByTimeAsync(params.pollIntervalMs ?? POLL)
  controller.abort()
  await vi.advanceTimersByTimeAsync(0)
  await done
  return { events, controller, done }
}

describe('streamEvents', () => {
  it('emits jobs + notifications on the first tick', async () => {
    const { deps } = makeDeps({ jobs: () => ({ items: [job()], total: 2 }), unread: () => 3 })
    const { events } = await run(deps, baseParams(), 1)
    expect(events).toEqual([
      { event: 'jobs', data: { activeCount: 2 } },
      { event: 'notifications', data: { unreadCount: 3 } },
    ])
  })

  it('dedups when fingerprints are unchanged across ticks', async () => {
    const { deps } = makeDeps({ jobs: () => ({ items: [job()], total: 2 }), unread: () => 3 })
    const { events } = await run(deps, baseParams(), 5)
    // Steady state: each domain emits exactly once despite many polls.
    expect(events.filter((e) => e.event === 'jobs')).toHaveLength(1)
    expect(events.filter((e) => e.event === 'notifications')).toHaveLength(1)
  })

  it('re-emits when a fingerprint changes', async () => {
    let count = 1
    const { deps } = makeDeps({ unread: () => count, jobs: () => ({ items: [], total: 0 }) })
    const controller = new AbortController()
    const events: EventsMessage[] = []
    const done = streamEvents(deps, baseParams(), controller.signal, (m) => events.push(m))
    await vi.advanceTimersByTimeAsync(0) // tick 1 → unreadCount 1
    count = 2
    await vi.advanceTimersByTimeAsync(POLL) // tick 2 → unreadCount 2 (changed)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await done
    const unread = events.filter((e) => e.event === 'notifications').map((e) => e.data)
    expect(unread).toEqual([{ unreadCount: 1 }, { unreadCount: 2 }])
  })

  it('emits a heartbeat on quiet ticks once the heartbeat interval elapses', async () => {
    const { deps } = makeDeps() // empty jobs, zero unread
    const { events } = await run(deps, baseParams({ heartbeatIntervalMs: 0 }), 3)
    // Tick 1 still publishes the initial unread count (0) — its fingerprint goes
    // from "" to "0" — which suppresses that tick's heartbeat. Later quiet ticks
    // (no change) emit heartbeats.
    expect(events.filter((e) => e.event === 'notifications')).toEqual([
      { event: 'notifications', data: { unreadCount: 0 } },
    ])
    expect(events.some((e) => e.event === 'heartbeat')).toBe(true)
  })

  it('does not heartbeat on a tick that already emitted a domain change', async () => {
    const { deps } = makeDeps({ unread: () => 5, jobs: () => ({ items: [], total: 0 }) })
    const { events } = await run(deps, baseParams({ heartbeatIntervalMs: 0 }), 1)
    // First (and only) tick changed (unread 5) → no heartbeat that tick.
    expect(events).toEqual([{ event: 'notifications', data: { unreadCount: 5 } }])
  })

  it('emits an error event when a domain query throws, then keeps polling', async () => {
    const list = vi.fn(async (_orgId: string, opts: { status?: string }) => {
      if (opts.status === 'queued') return { items: [], total: 0 }
      throw new Error('db down')
    })
    const deps = {
      backgroundJobs: { list } as unknown as BackgroundJobRepo,
      notifications: { unreadCount: vi.fn(async () => 0) } as unknown as NotificationRepo,
      downloadTasks: {} as Deps['downloadTasks'],
    } as Deps
    const { events } = await run(deps, baseParams(), 3)
    expect(events.some((e) => e.event === 'error' && (e.data as { message: string }).message === 'db down')).toBe(true)
    expect(list.mock.calls.length).toBeGreaterThan(2) // loop survived the throw
  })

  it('stops polling once the signal aborts', async () => {
    const { deps, unreadCount } = makeDeps({ unread: () => 1 })
    const controller = new AbortController()
    const done = streamEvents(deps, baseParams(), controller.signal, () => {})
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    await done
    const callsAtAbort = unreadCount.mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL * 3)
    expect(unreadCount.mock.calls.length).toBe(callsAtAbort) // no further polling
  })

  it('skips jobs/notifications when orgId/userId are null', async () => {
    const { deps, list, unreadCount } = makeDeps()
    await run(deps, baseParams({ orgId: null, userId: null }), 2)
    expect(list).not.toHaveBeenCalled()
    expect(unreadCount).not.toHaveBeenCalled()
  })

  it('limits download-tasks-only scope to the org-scoped download-task domain', async () => {
    vi.mocked(listDownloadTasks).mockResolvedValue({ items: [task('d1', 't0')], total: 1 })
    const { deps, list, unreadCount } = makeDeps()

    const { events } = await run(deps, baseParams({ scope: 'download-tasks-only', wantsDownloadTasks: true }), 2)

    expect(list).not.toHaveBeenCalled()
    expect(unreadCount).not.toHaveBeenCalled()
    expect(listDownloadTasks).toHaveBeenCalledWith(deps, platform, expect.objectContaining({ orgId: 'o1' }))
    expect(events.filter((event) => event.event === 'download-tasks')).toEqual([
      { event: 'download-tasks', data: { items: [task('d1', 't0')], total: 1, page: 1, pageSize: 50 } },
    ])
  })

  describe('download tasks (opt-in)', () => {
    it('polls download tasks only when wantsDownloadTasks is set, and dedups', async () => {
      vi.mocked(listDownloadTasks).mockResolvedValue({ items: [task('d1', 't0')], total: 1 })
      const { deps } = makeDeps()
      const { events } = await run(deps, baseParams({ wantsDownloadTasks: true }), 4)
      expect(listDownloadTasks).toHaveBeenCalled()
      const dt = events.filter((e) => e.event === 'download-tasks')
      expect(dt).toHaveLength(1)
      expect(dt[0].data).toEqual({ items: [task('d1', 't0')], total: 1, page: 1, pageSize: 50 })
    })

    it('does not poll download tasks when not opted in', async () => {
      const { deps } = makeDeps()
      await run(deps, baseParams({ wantsDownloadTasks: false }), 2)
      expect(listDownloadTasks).not.toHaveBeenCalled()
    })

    it('re-emits download tasks when an item updatedAt changes', async () => {
      vi.mocked(listDownloadTasks)
        .mockResolvedValueOnce({ items: [task('d1', 't0')], total: 1 })
        .mockResolvedValue({ items: [task('d1', 't1')], total: 1 })
      const { deps } = makeDeps()
      const { events } = await run(deps, baseParams({ wantsDownloadTasks: true }), 4)
      const dt = events.filter((e) => e.event === 'download-tasks')
      expect(dt.length).toBeGreaterThanOrEqual(2)
    })
  })
})
