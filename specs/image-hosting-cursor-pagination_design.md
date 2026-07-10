# Feature: Deterministic image-hosting cursor pagination

## Requirements

- While a gallery is traversed, when multiple images share a creation timestamp, the API shall return each image once in ascending `(createdAt, id)` order.
- While a client continues a live traversal, when rows are inserted or deleted, the API shall continue strictly after the last emitted tuple without revisiting earlier tuples.
- When a client supplies a malformed cursor, the API shall return the standard typed HTTP 400 error.
- When no later row exists, the API shall return `nextCursor: null`; clients shall use that value as the only terminal signal.

## Architecture

- Frontend: use the shared `CursorPage<ImageHosting>` contract and keep the existing `{ items, nextCursor }` wire shape.
- Backend: decode a versioned opaque base64url cursor at the application boundary, pass a typed `(createdAt, id)` keyset to the repository, and query/order by that same tuple. A composite index supports the gallery traversal.
- Security: keep existing authentication, team authorization, and organization scoping. Strictly validate cursor encoding, version, timestamp, and ID before any database query; render failures through the existing AIP-193 error path.

## Live-list semantics

This endpoint provides a live keyset traversal, not snapshot isolation. Inserts whose tuples sort after the cursor are eligible for later pages; inserts at or before it are not revisited. Deleting an unseen row removes it from later pages, while deleting an already-returned row does not move the continuation boundary. Every surviving row after the boundary is returned once.

## Implementation Plan

- [x] Add the shared cursor-page schema/type and explicit image-hosting component name.
- [x] Add strict cursor encoding/decoding and typed repository keysets.
- [x] Apply tuple filtering/ordering and add the matching database index.
- [x] Align the frontend and generated Go client contract names.
- [x] Add feature scenarios and focused HTTP/SDK tests for all pagination semantics.
