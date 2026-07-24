# Feature: Curated profile shares

## Requirements

- While a user creates an untargeted landing share, when they select “Show on personal homepage”, the system shall atomically create the share with a profile listing.
- While an authenticated owner views sent shares, when they list or unlist an eligible landing share, the system shall update only its profile-listing state.
- While an anonymous visitor requests a public profile, the system shall return only that owner’s currently listed and accessible untargeted landing shares.
- While a visitor opens a listed item, the system shall use the existing `/s/:token` landing and folder-navigation flow.

## Architecture

### Frontend

- Add an optional homepage switch to the existing share-creation dialog. It is available only for untargeted landing shares and resets when another mode is selected.
- Add list/unlist controls to eligible rows on the authenticated sent Shares page.
- Render concrete file/folder cards on `/u/:username`, linked only to `/s/:token`.
- Add a public-homepage link to the secondary profile settings page.
- Surface mutation failures through the existing toast error pattern.

### Backend

- Add nullable `shares.listedAt`; existing shares remain unlisted.
- Generate the migration with `pnpm db:generate`.
- Extend share creation with `showOnProfile?: boolean`, persisted atomically with the share.
- Model the owner-controlled selection as `PUT` and `DELETE /api/shares/:token/profile-listing`.
- Return the updated listing state from `PUT`; make `DELETE` idempotent for an owned eligible share.
- Remove the unused `GET /api/users/:username/objects` placeholder.
- Define the public profile response with a shared Zod schema and inferred wire types.
- Query curated shares using an inner join to the target and read-time predicates for listing, owner, landing kind, no recipients, active status, unexpired limit, remaining downloads, active target, and non-trashed/non-purged target.

### Security

- Require authentication on listing mutations and scope writes by both token and creator ID.
- Revalidate landing kind and the absence of recipients on the server; forged direct or targeted requests return a stable validation error.
- Never expose password hashes, internal IDs, organization IDs, recipient data, or raw object locations in public profile output.
- Select public response columns explicitly and order listings deterministically by `listedAt` then share ID.
- Unlisting changes only `listedAt`; it never revokes the share.
- Existing share landing/password/download/folder checks remain the sole public object-access path.

## Implementation Plan

- [x] Add schema field, generated migration, port/repository operations, and shared schemas.
- [x] Add creation and profile-listing use cases plus REST routes.
- [x] Replace profile placeholders with the curated read model and remove `/objects`.
- [x] Add dialog, Shares page, public profile, settings-link, and locale changes.
- [x] Add Node, Cloudflare, wrapper, React, OpenAPI, and browser acceptance tests.
- [ ] Run focused verification, full quality gates, CI, and branch-preview journeys.
