import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { errorResponseSchema } from '@shared/schemas'
import { createMiddleware } from 'hono/factory'
import { requirePermission } from '../middleware/authz'
import type { Env } from '../middleware/platform'
import { type EventsMessage, streamEvents } from '../usecases/events'
import { forbidden, unauthorized } from '../usecases/ports'

const encoder = new TextEncoder()

const requireEventsAccess = createMiddleware<Env>(async (c, next) => {
  const principal = c.get('principal')
  if (principal?.kind === 'user') {
    await next()
    return
  }
  if (principal?.kind === 'api-key') {
    if (!principal.orgId) throw forbidden('Forbidden')
    await next()
    return
  }
  throw unauthorized('Unauthorized')
})

// The SSE body is a stream of text/event-stream frames, not JSON, so the schema
// is just a string. OpenAPI 3.x has no native way to type the named events of a
// single stream, so they're spelled out in the route description below.
const eventStreamRoute = createRoute({
  operationId: 'streamEvents',
  tags: ['Events'],
  method: 'get',
  path: '/',
  middleware: [requireEventsAccess, requirePermission('remoteDownload', 'read')] as const,
  summary: 'Server-sent events stream',
  description: [
    'A single SSE connection multiplexing several domains via named events:',
    '',
    '- `resource-change` → `{ sequence, resourceType, resourceId, changeType, action, metadata, occurredAt }`',
    '- `resync` → `{ sequence }` — the resume cursor is older than retained changes; invalidate active queries',
    '- `heartbeat` → `{ at }` — keep-alive emitted when nothing changed for a while',
    '- `error` → `{ message }` — a domain query failed this tick',
    '',
    'Workspace-scoped API keys require `remoteDownload:read`. Their stream is limited to download-task changes from the key workspace plus heartbeat and error control events.',
  ].join('\n'),
  responses: {
    200: {
      content: { 'text/event-stream': { schema: z.string() } },
      description: 'Open SSE stream of domain-change events',
    },
    401: { content: { 'application/json': { schema: errorResponseSchema } }, description: 'Unauthorized' },
    403: { content: { 'application/json': { schema: errorResponseSchema } }, description: 'Forbidden' },
  },
})

// One SSE stream multiplexing several domains via named events:
//   event: resource-change → durable invalidation event
//   event: resync          → retention gap; refetch active queries
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
  // One controller, aborted from BOTH teardown paths. In Workers the request
  // signal and ReadableStream.cancel() are independent: passing c.req.raw.signal
  // straight to the usecase would leak the poll loop when only the body consumer
  // cancels. So we own the controller and bridge both into it.
  const abort = new AbortController()
  c.req.raw.signal.addEventListener('abort', () => abort.abort())

  const params = {
    platform: c.get('platform'),
    scope: c.get('principal')?.kind === 'api-key' ? ('download-tasks-only' as const) : ('user' as const),
    orgId: c.get('orgId'),
    userId: c.get('userId'),
    afterSequence: parseLastEventId(c.req.header('Last-Event-ID')),
  }

  // One teardown signal fed from both independent Workers paths (request abort
  // AND body-consumer cancel). streamClosed guards the controller: a consumer
  // cancel() already closes the controller before it fires the abort listener,
  // so closing again would throw ERR_INVALID_STATE.
  let streamClosed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (message: EventsMessage) => {
        const id = message.id === undefined ? '' : `id: ${message.id}\n`
        controller.enqueue(encoder.encode(`${id}event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`))
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

function parseLastEventId(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const sequence = Number(value)
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined
}

export default events
