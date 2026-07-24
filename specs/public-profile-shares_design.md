# Feature: Public profile shares

## Requirements

- While a user creates an untargeted landing share, the system shall make it public by default unless they enable “Private share”.
- While an authenticated owner views sent shares, when they change an eligible landing share between public and private, the system shall update only its privacy state.
- While an anonymous visitor requests a public profile, the system shall return only that owner’s accessible, non-private, untargeted landing shares.
- While a visitor opens a public item, the system shall use the existing `/s/:token` landing and folder-navigation flow.

## Architecture

### Frontend

- Add a “Private share” switch to the existing share-creation dialog. It is off by default, available only for untargeted landing shares, and resets when another mode is selected.
- Add public/private controls to eligible rows on the authenticated sent Shares page.
- Render concrete file/folder cards on `/u/:username`, linked only to `/s/:token`.
- Add a public-homepage link to the secondary profile settings page.
- Surface mutation failures through the existing toast error pattern.

### Backend

- Add non-null `shares.private` with a default of `false`; existing shares become public.
- Generate the migration with `pnpm db:generate`.
- Extend share creation with `private?: boolean`, persisted atomically with the share.
- Model the owner-controlled state as `PUT /api/shares/:token/privacy` with `{ private: boolean }`.
- Return the updated privacy state from `PUT`.
- Remove the unused `GET /api/users/:username/objects` placeholder.
- Define the public profile response with a shared Zod schema and inferred wire types.
- Query public shares using an inner join to the target and read-time predicates for `private = false`, owner, landing kind, no recipients, active status, unexpired limit, remaining downloads, active target, and non-trashed/non-purged target.

### Security

- Require authentication on privacy mutations and scope writes by both token and creator ID.
- Revalidate landing kind and the absence of recipients on the server; direct or targeted privacy requests return a stable validation error.
- Never expose password hashes, internal IDs, organization IDs, recipient data, or raw object locations in public profile output.
- Select public response columns explicitly and order shares deterministically by `createdAt` then share ID.
- Changing privacy never revokes the share; anyone with its URL can still use the existing access flow.
- Existing share landing/password/download/folder checks remain the sole public object-access path.

## Implementation Plan

- [x] Add schema field, generated migration, port/repository operations, and shared schemas.
- [x] Add creation and privacy use cases plus REST routes.
- [x] Replace profile placeholders with the public-share read model and remove `/objects`.
- [x] Add dialog, Shares page, public profile, settings-link, and locale changes.
- [x] Add Node, Cloudflare, wrapper, React, OpenAPI, and browser acceptance tests.
- [ ] Run focused verification, full quality gates, CI, and branch-preview journeys.
