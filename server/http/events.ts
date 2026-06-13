import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { listDownloadTasks } from '../services/downloads'

const encoder = new TextEncoder()
// How often the stream re-reads each subscribed domain to detect changes. Kept
// short so background-job progress and download transfers surface quickly.
const POLL_INTERVAL_MS = 2000
// How long the stream may stay silent before emitting a keep-alive. Decoupled
// from POLL_INTERVAL_MS so an idle connection isn't chatty.
const HEARTBEAT_INTERVAL_MS = 25_000
const ACTIVE_JOB_SCAN_SIZE = 100
const DOWNLOAD_TASK_PAGE_SIZE = 50

// Per-connection subscription, carried in the EventSource URL. Always-on domains
// (jobs, notifications) need no opt-in; page-scoped domains (download tasks) are
// polled only when the client asks for them, so an idle browser tab doesn't make
// the server scan resources no page is showing.
const eventsQuerySchema = z.object({
  downloadTasks: z.string().optional(),
  dtStatus: z.string().optional(),
  dtCategory: z.string().optional(),
  dtTag: z.string().optional(),
  dtSortBy: z
    .enum(['createdAt', 'source', 'category', 'tags', 'status', 'progress', 'eta'])
    .optional()
    .catch(undefined),
  dtSortDir: z.enum(['asc', 'desc']).optional().catch(undefined),
})

// One SSE stream multiplexing several domains via named events:
//   event: jobs           → { activeCount }                 background-job set changed (always on)
//   event: notifications  → { unreadCount }                 unread count changed (always on)
//   event: download-tasks → { items, total, page, pageSize } download tasks changed (opt-in via ?downloadTasks=1)
//   event: heartbeat      → { at }                          no change for HEARTBEAT_INTERVAL_MS
//   event: error          → { message }                     a domain query failed this tick
//
// The browser opens a single EventSource and dispatches by event name; each
// handler refreshes the matching React Query cache. See src/hooks/useServerEvents.ts.
//
// Mirrors the fingerprint approach of the old /api/download-tasks/events: re-read
// each domain on a fixed interval, emit only when a cheap fingerprint changes —
// a pure change-notifier with no pub/sub.
export const events = new Hono<Env>().use(requireAuth).get('/', (c) => {
  const platform = c.get('platform')
  const deps = c.get('deps')
  const orgId = c.get('orgId')
  const userId = c.get('userId')
  const query = eventsQuerySchema.parse(c.req.query())
  const wantsDownloadTasks = query.downloadTasks === '1'
  const signal = c.req.raw.signal
  let closed = false
  let lastEmitAt = Date.now()
  let jobsFingerprint = ''
  let unreadFingerprint = ''
  let downloadTasksFingerprint = ''

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        lastEmitAt = Date.now()
      }

      const tick = async () => {
        if (closed) return
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
              send('jobs', { activeCount: queued.total + running.total })
              changed = true
            }
          }

          if (userId) {
            const count = await deps.notifications.unreadCount(userId)
            const fingerprint = String(count)
            if (fingerprint !== unreadFingerprint) {
              unreadFingerprint = fingerprint
              send('notifications', { unreadCount: count })
              changed = true
            }
          }

          if (wantsDownloadTasks && orgId) {
            const result = await listDownloadTasks(platform, {
              orgId,
              status: query.dtStatus,
              category: query.dtCategory,
              tag: query.dtTag,
              sortBy: query.dtSortBy,
              sortDir: query.dtSortDir,
              page: 1,
              pageSize: DOWNLOAD_TASK_PAGE_SIZE,
            })
            const fingerprint = result.items.map((task) => `${task.id}:${task.status.updatedAt}`).join('|')
            if (fingerprint !== downloadTasksFingerprint) {
              downloadTasksFingerprint = fingerprint
              send('download-tasks', {
                items: result.items,
                total: result.total,
                page: 1,
                pageSize: DOWNLOAD_TASK_PAGE_SIZE,
              })
              changed = true
            }
          }

          if (!changed && Date.now() - lastEmitAt >= HEARTBEAT_INTERVAL_MS) {
            send('heartbeat', { at: new Date().toISOString() })
          }
        } catch (error) {
          send('error', { message: error instanceof Error ? error.message : 'unknown error' })
        }
        if (!closed) setTimeout(tick, POLL_INTERVAL_MS)
      }

      signal.addEventListener('abort', () => {
        closed = true
        controller.close()
      })
      void tick()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

export default events
