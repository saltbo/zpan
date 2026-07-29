# Agent Authentication And Authorization

ZPan v2.9 uses one authorization contract for browser sessions, API keys, and
future agent OAuth credentials. Routes declare their access requirements once;
the declaration drives runtime enforcement and OpenAPI metadata.

## Canonical Scopes

Canonical scopes live in `shared/authorization.ts`. Scope names are lowercase
business authorities in `plural-resource:action` form. They have no `zpan`
prefix, no wildcard semantics, and no prefix matching.

Current special-purpose scopes are:

- `images:upload`
- `objects:read`
- `objects:create`
- `objects:update`
- `objects:delete` for soft delete only
- `objects:move`
- `objects:purge` for permanent purge only; not agent-grantable
- `download-tasks:read`
- `download-tasks:create`
- `download-tasks:cancel`

UI labels such as Reader, File manager, and Publisher are profile templates
only. They are never route permissions.

## Normalized Context

`authMiddleware` continues to populate the legacy `principal`, `userId`, and
`orgId` fields while migration is in progress. New authorization code reads
`authzContext`, which normalizes:

- authorizing user when one exists
- session workspace or credential-fixed workspace
- granted scopes for scoped credentials
- audit actor type and reference
- credential state such as API-key config ID

Cookie sessions are first-party unbounded credentials for scope checks. They
still must satisfy route role, workspace, ownership, and resource policies.
API keys and future OAuth credentials must satisfy every declared scope.

Fixed-workspace credentials cannot be overridden by request body, query
parameters, or session active organization.

## Denials And Auditing

Missing credentials return `401`. Valid credentials that miss a scope, target
the wrong workspace, or fail the current role/resource policy return `403`.

Authenticated `403` denials record safe audit events with action
`authorization_denied`. These records identify the credential class and denial
reason, but do not include resource-existence details. Anonymous `401` denials
are not audited.

Audit actors support `user`, `api_key`, `agent_oauth`, `agent`, `downloader`,
and `task-upload`.

## Route Declarations

New protected OpenAPI routes should use `authRoute()` from
`server/http/openapi.ts`. The route authorization declaration is the source of
truth for both:

- runtime middleware through `authorize(auth)`
- OpenAPI `security` and `x-zpan-auth` metadata

Every OpenAPI operation should eventually be explicitly `public`, `internal`,
or protected by an authorization declaration. Tasks after this kernel migration
own converting the remaining production routers.

## Legacy Permission Backfill

Existing API keys may store legacy Better Auth permission JSON. Run the
one-time operator backfill before deploying code that only recognizes canonical
scopes:

```sh
pnpm api-key-scopes:backfill -- --sqlite zpan.db
pnpm api-key-scopes:backfill -- --sqlite zpan.db --apply

pnpm api-key-scopes:backfill -- --d1 zpan-db --remote
pnpm api-key-scopes:backfill -- --d1 zpan-db --remote --apply
```

The backfill is idempotent and rewrites:

- `ihost:upload` to `images:upload`
- `webdav:read` to `objects:read`
- `webdav:write` to `objects:create`, `objects:update`, `objects:delete`, and
  `objects:move`
- `remoteDownload:read` to `download-tasks:read`
- `remoteDownload:create` to `download-tasks:create`
- `remoteDownload:cancel` to `download-tasks:cancel`
