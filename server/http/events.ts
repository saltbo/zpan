import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { errorResponseSchema } from '@shared/schemas'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { type EventsMessage, streamEvents } from '../usecases/events'

const encoder = new TextEncoder()

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

// The wire/doc contract for the query string. Kept to lenient optional strings
// (no enum, no `.catch()`): the OpenAPI generator can't map a ZodCatch, and a
// malformed sort param must be silently ignored — never 400 an always-on stream.
// The strict coercion still happens in the handler via `eventsQuerySchema`.
const eventsQueryDocSchema = z.object({
  downloadTasks: z.string().optional().openapi({ description: 'Set to "1" to subscribe to download-task events.' }),
  dtStatus: z.string().optional(),
  dtCategory: z.string().optional(),
  dtTag: z.string().optional(),
  dtSortBy: z
    .string()
    .optional()
    .openapi({ description: 'One of: createdAt | source | category | tags | status | progress | eta' }),
  dtSortDir: z.string().optional().openapi({ description: 'asc | desc' }),
})

// The SSE body is a stream of text/event-stream frames, not JSON, so the schema
// is just a string. OpenAPI 3.x has no native way to type the named events of a
// single stream, so they're spelled out in the route description below.
const eventStreamRoute = createRoute({
  operationId: 'streamEvents',
  tags: ['Events'],
  method: 'get',
  path: '/',
  middleware: [requireAuth] as const,
  summary: 'Server-sent events stream',
  description: [
    'A single SSE connection multiplexing several domains via named events:',
    '',
    '- `jobs` → `{ activeCount }` — background-job set changed (always on)',
    '- `notifications` → `{ unreadCount }` — unread count changed (always on)',
    '- `download-tasks` → `{ items, total, page, pageSize }` — download tasks changed (opt-in via `?downloadTasks=1`)',
    '- `heartbeat` → `{ at }` — keep-alive emitted when nothing changed for a while',
    '- `error` → `{ message }` — a domain query failed this tick',
  ].join('\n'),
  request: { query: eventsQueryDocSchema },
  responses: {
    200: {
      content: { 'text/event-stream': { schema: z.string() } },
      description: 'Open SSE stream of domain-change events',
    },
    401: { content: { 'application/json': { schema: errorResponseSchema } }, description: 'Unauthorized' },
  },
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
// This handler owns only the wire: it builds the ReadableStream, encodes each
// domain event the usecase emits as an SSE frame, and returns the Response. All
// polling / fingerprint / change-detection lives in streamEvents (usecases/events.ts).
export const events = new OpenAPIHono<Env>().openapi(eventStreamRoute, (c) => {
  const deps = c.get('deps')
  const query = eventsQuerySchema.parse(c.req.query())

  // One controller, aborted from BOTH teardown paths. In Workers the request
  // signal and ReadableStream.cancel() are independent: passing c.req.raw.signal
  // straight to the usecase would leak the poll loop when only the body consumer
  // cancels. So we own the controller and bridge both into it.
  const abort = new AbortController()
  c.req.raw.signal.addEventListener('abort', () => abort.abort())

  const params = {
    platform: c.get('platform'),
    orgId: c.get('orgId'),
    userId: c.get('userId'),
    wantsDownloadTasks: query.downloadTasks === '1',
    dtStatus: query.dtStatus,
    dtCategory: query.dtCategory,
    dtTag: query.dtTag,
    dtSortBy: query.dtSortBy,
    dtSortDir: query.dtSortDir,
  }

  // One teardown signal fed from both independent Workers paths (request abort
  // AND body-consumer cancel). streamClosed guards the controller: a consumer
  // cancel() already closes the controller before it fires the abort listener,
  // so closing again would throw ERR_INVALID_STATE.
  let streamClosed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (message: EventsMessage) => {
        controller.enqueue(encoder.encode(`event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`))
      }
      abort.signal.addEventListener('abort', () => {
        if (streamClosed) return
        streamClosed = true
        controller.close()
      })
      void streamEvents(deps, params, abort.signal, emit)
    },
    cancel() {
      streamClosed = true
      abort.abort()
    },
  })

  return c.newResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

export default events
