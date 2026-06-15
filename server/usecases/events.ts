// The events resource usecase. Owns the multiplexed-SSE *domain* side of the
// /api/events stream: it polls every subscribed domain on a fixed interval,
// fingerprints each one, and emits a domain event only when a fingerprint
// changes — a pure change-notifier with no pub/sub. Keep-alive cadence and the
// change-detection logic live here so the http handler is left with nothing but
// the wire format.
//
// All deps-port access (background jobs, notifications, download tasks) is
// confined to this file. The handler owns the ReadableStream / Response / SSE
// framing and never touches a port. Mirrors the streaming convention of
// hono-cf-clean-arch: `(deps, params, signal, emit)`, resolves on abort.

import type { Platform } from '../platform/interface'
import type { Deps } from './deps'
import { listDownloadTasks } from './downloads/downloads'

// How often the stream re-reads each subscribed domain to detect changes. Kept
// short so background-job progress and download transfers surface quickly.
const POLL_INTERVAL_MS = 2000
// How long the stream may stay silent before emitting a keep-alive. Decoupled
// from POLL_INTERVAL_MS so an idle connection isn't chatty.
const HEARTBEAT_INTERVAL_MS = 25_000
const ACTIVE_JOB_SCAN_SIZE = 100
const DOWNLOAD_TASK_PAGE_SIZE = 50

// A single named SSE event the handler will serialize to the wire. `event` is
// the SSE event name; `data` is JSON-stringified into the data field.
export type EventsMessage = { event: string; data: unknown }

export type EventsEmit = (message: EventsMessage) => void

// Per-connection subscription resolved from the EventSource URL. Always-on
// domains (jobs, notifications) are read whenever orgId/userId is present;
// page-scoped domains (download tasks) are polled only when the client opts in,
// so an idle browser tab doesn't make the server scan resources no page shows.
export type EventsParams = {
  platform: Platform
  orgId: string | null
  userId: string | null
  wantsDownloadTasks: boolean
  dtStatus?: string
  dtCategory?: string
  dtTag?: string
  dtSortBy?: 'createdAt' | 'source' | 'category' | 'tags' | 'status' | 'progress' | 'eta'
  dtSortDir?: 'asc' | 'desc'
  // Overridable so tests can drive the loop deterministically with tiny/zero
  // intervals. Production callers omit them and get the constants above.
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
}

const delay = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(onDone, ms)
    const onAbort = () => {
      clearTimeout(timer)
      onDone()
    }
    function onDone() {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort)
  })

// Streams domain-change events until `signal` aborts. Polls each subscribed
// domain every `pollIntervalMs`, emits on fingerprint change, and inserts a
// `heartbeat` whenever no change has been sent for `heartbeatIntervalMs`. A
// failed tick emits a single `error` event and the loop continues. Resolves
// once the signal aborts (the caller's ReadableStream owns teardown).
export async function streamEvents(
  deps: Deps,
  params: EventsParams,
  signal: AbortSignal,
  emit: EventsEmit,
): Promise<void> {
  const {
    platform,
    orgId,
    userId,
    wantsDownloadTasks,
    dtStatus,
    dtCategory,
    dtTag,
    dtSortBy,
    dtSortDir,
    pollIntervalMs = POLL_INTERVAL_MS,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  } = params

  let lastEmitAt = Date.now()
  let jobsFingerprint = ''
  let unreadFingerprint = ''
  let downloadTasksFingerprint = ''

  const send: EventsEmit = (message) => {
    emit(message)
    lastEmitAt = Date.now()
  }

  while (!signal.aborted) {
    try {
      let changed = false

      if (orgId) {
        const [queued, running] = await Promise.all([
          deps.backgroundJobs.list(orgId, { status: 'queued', page: 1, pageSize: ACTIVE_JOB_SCAN_SIZE }),
          deps.backgroundJobs.list(orgId, { status: 'running', page: 1, pageSize: ACTIVE_JOB_SCAN_SIZE }),
        ])
        const fingerprint = [...queued.items, ...running.items]
          .map((job) => `${job.id}:${job.status}:${job.updatedAt}:${job.progress.processedBytes}`)
          .join('|')
        if (fingerprint !== jobsFingerprint) {
          jobsFingerprint = fingerprint
          send({ event: 'jobs', data: { activeCount: queued.total + running.total } })
          changed = true
        }
      }

      if (userId) {
        const count = await deps.notifications.unreadCount(userId)
        const fingerprint = String(count)
        if (fingerprint !== unreadFingerprint) {
          unreadFingerprint = fingerprint
          send({ event: 'notifications', data: { unreadCount: count } })
          changed = true
        }
      }

      if (wantsDownloadTasks && orgId) {
        const result = await listDownloadTasks(deps, platform, {
          orgId,
          status: dtStatus,
          category: dtCategory,
          tag: dtTag,
          sortBy: dtSortBy,
          sortDir: dtSortDir,
          page: 1,
          pageSize: DOWNLOAD_TASK_PAGE_SIZE,
        })
        const fingerprint = result.items.map((task) => `${task.id}:${task.status.updatedAt}`).join('|')
        if (fingerprint !== downloadTasksFingerprint) {
          downloadTasksFingerprint = fingerprint
          send({
            event: 'download-tasks',
            data: {
              items: result.items,
              total: result.total,
              page: 1,
              pageSize: DOWNLOAD_TASK_PAGE_SIZE,
            },
          })
          changed = true
        }
      }

      if (!changed && Date.now() - lastEmitAt >= heartbeatIntervalMs) {
        send({ event: 'heartbeat', data: { at: new Date().toISOString() } })
      }
    } catch (error) {
      send({ event: 'error', data: { message: error instanceof Error ? error.message : 'unknown error' } })
    }

    if (signal.aborted) break
    await delay(pollIntervalMs, signal)
  }
}
