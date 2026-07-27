# List Pagination and Realtime Changes

## Decision

Unbounded ZPan-owned collections use one public pagination contract:

```ts
type CursorPage<T> = {
  items: T[]
  nextPageToken: string | null
}
```

Clients pass `pageSize` and, after the first request, the opaque
`nextPageToken` as `pageToken`. Product lists load the next page when a bottom
sentinel approaches the viewport; they do not expose page-number controls.
Counts needed independently by navigation or dashboards use a dedicated stats
endpoint instead of making every page query execute a count.

Small collections with a hard product limit may return `{ items }`. They must
not add offset pagination preemptively.

## Cursor Rules

- Repositories use keyset pagination over an explicit, immutable total order.
  Every order ends in the row id as a deterministic tie-breaker.
- Repositories fetch `pageSize + 1` rows and return the last visible row as an
  internal boundary only when another row exists.
- HTTP handlers are the only layer that encodes or decodes page tokens.
- Tokens are HMAC-SHA256 signed with the instance secret, expire after 72
  hours, and bind the boundary to a fingerprint of the authenticated scope,
  filters, ordering, and page size.
- Invalid, expired, tampered, or cross-query tokens fail with
  `INVALID_PAGE_TOKEN`; handlers never reinterpret them as a first-page request.
- Token contents are an implementation detail. API consumers must not decode,
  persist indefinitely, synthesize, or compare them.

The shared contract lives in `shared/schemas/pagination.ts`; HTTP token signing
lives in `server/http/page-token.ts`.

## Realtime Model

The browser owns one `/api/events` `EventSource` for the authenticated session.
Pages subscribe locally by resource type. Opening another page or changing a
list filter does not create another server connection.

Mutations write a `resource_changes` row in the same database transaction as
the resource state change. The row contains:

- a global autoincrement sequence used as the SSE id;
- user or organization scope;
- resource type and id;
- change type, action, optional metadata, and occurrence time.

The stream sends `resource-change` facts, never rendered rows or replacement
pages. TanStack Query remains the read authority:

- download-task updates fetch that task through the detail endpoint, update its
  detail cache, and project the list fields into already-loaded cursor pages;
- creates, wildcard changes, retention gaps, and changes that may enter an
  unloaded filtered result reset the affected collection.

List items contain only fields needed to render and operate a row. Detail-only
arrays such as task files, peers, and trackers are returned only by the
single-task detail endpoint. Small detail collections remain ordinary lists;
they are not virtualized.

The downloader agent uses a separate assigned-task endpoint because it needs
the full execution contract, including upload credentials. Browser list
contracts never expose those fields.

`Last-Event-ID` resumes after a disconnect. Changes are retained for seven
days. If a client asks for a sequence older than retained history, the stream
emits `resync`; the client invalidates all active queries.

## Why the Durable Table Exists

SSE is a delivery protocol, not an event store. An in-memory broadcaster loses
events during disconnects and cannot coordinate multiple Workers or Node
processes. A durable change row provides replay, monotonic ordering, and
state/change atomicity on both D1 and SQLite without introducing a
runtime-specific coordinator.

The initial transport polls the indexed change feed. Durable Objects, Queues,
or a pub/sub service may later reduce wake-up latency, but they do not replace
`resource_changes`: delivery acceleration and durable replay solve different
problems.

Old rows are operational invalidation data, not domain audit history, and are
purged by the hourly scheduler.
