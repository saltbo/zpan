# Feature: Organization API key download-task events

## Requirements

- While a browser user is authenticated, when they open the event stream, the system shall preserve job, notification, and optional download-task events.
- While an organization API key has `remoteDownload:read`, when it opens `/api/events?downloadTasks=1`, the system shall stream only download tasks from that organization.
- While an API key lacks the required permission, when it opens the download-task stream, the system shall respond with 403.
- While credentials are missing or invalid, when the event stream is requested, the system shall respond with 401.

## Architecture

### Frontend

- No change. Browser `EventSource` behavior and query parameters remain compatible.

### Backend

- Keep the existing `/api/events` resource and SSE wire format.
- Gate organization API keys on `downloadTasks=1`, then reuse the existing `remoteDownload:read` permission middleware.
- Pass an explicit `user` or `download-tasks-only` scope to the event use case.
- Continue scoping download-task queries with the authenticated principal's organization ID.

### Security

- Resolve credentials through the production authentication middleware.
- Return 401 for unauthenticated principals and 403 for authenticated API keys outside the permitted query/permission contract.
- Suppress job and notification domains for `download-tasks-only` streams.
- Preserve repository-level organization filtering so another organization's tasks cannot enter the response.

## Implementation Plan

- [x] Extend executable behavior and HTTP integration coverage.
- [x] Add the route-specific principal/query gate and permission composition.
- [x] Add least-privilege event-stream scope handling.
- [x] Document 401/403 and API-key stream behavior in OpenAPI.
- [x] Run focused, quality, Cloudflare, and review gates.
