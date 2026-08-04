# External OAuth Apps

> Status: Implemented
> Standards: OAuth 2.1, RFC 7591, RFC 8693, RFC 8707, RFC 9126, RFC 9396, RFC 9449

## Model

ZPan is both an OAuth authorization server and the protected resource for its
HTTP API. External Agent platforms dynamically register their own client, ask a
user for access, and exchange that user-approved subject grant for a short-lived
DPoP-bound token used by one Agent.

The authorization model has three independent dimensions:

- `scope` says what an operation may do;
- RFC 9396 `authorization_details` says which workspace it may affect;
- current site and workspace roles apply resource-local constraints.

Authentication only establishes the credential and actor. It does not select a
permission model. Session cookies, API keys, OAuth tokens, and specialized
service credentials all enter the same route policy evaluator.

## Discovery

Starting from `https://zpan.example/api`, clients discover:

| Contract | Path |
|---|---|
| API discovery | `/api` |
| OpenAPI | `/api/openapi.json` |
| Upload workflows | `/api/workflows.arazzo.json` |
| Protected resource metadata | `/.well-known/oauth-protected-resource/api` |
| Authorization server metadata | `/.well-known/oauth-authorization-server/api/auth` |
| Dynamic client registration | `/api/auth/oauth2/register` |
| Dynamic client registration management (RFC 7592) | URI returned as `registration_client_uri` |
| Pushed authorization requests | `/api/auth/oauth2/par` |

Authorization-server metadata advertises `scopes_supported`,
`authorization_details_types_supported`, and
`pushed_authorization_request_endpoint`. ZPan does not maintain a second scope
catalog endpoint. RFC 7591 clients can register `authorization_details_types`;
ZPan persists and echoes supported values and rejects unknown types as invalid
client metadata.

New dynamic registrations also receive an opaque `registration_access_token`
and a client-specific `registration_client_uri`. The token is stored only as a
hash and authenticates RFC 7592 `GET`, full-replacement `PUT`, and `DELETE`
operations. Configuration reads and updates never return the OAuth
`client_secret`; the secret is returned only when initially issued. Clients
registered before RFC 7592 support remain valid but do not gain a management
credential retroactively. A controller that needs to change such a registration
creates a new registration generation and leaves existing connections pinned to
their original client identity until they are reconnected.

OpenAPI uses standard `security` declarations. Every protected ZPan operation
declares its OAuth scopes, plus cookie and bearer alternatives. Role constraints
that OpenAPI cannot express use the narrow
`x-zpan-authorization-constraints` extension. Better Auth operations and their
complete generated definitions remain owned by Better Auth and available from
its reference endpoints. The public product contract uses a deny-by-default
operation registry. Each admitted entry names the exact source path and method,
public path, stable operation ID, tags, and security policy; it may also declare
a narrow contract correction. The aggregator copies only path-item parameters
and the transitive local component closure reachable from that operation,
rejecting missing sources, collisions, dangling references, and external
references.

The registry currently imports only `POST /device/code` and `POST
/device/token`, under their `/api/auth` runtime mount, for the Downloader Device
Flow protocol; both explicitly require no existing session or bearer
credential. Adding a Better Auth operation to the product contract is therefore
an explicit contract and authorization decision made in one registry entry, not
an automatic consequence of installing or updating a plugin. ZPan separately
publishes its dynamic-registration and RFC 7592 configuration operations
implemented at the auth boundary.

## Workspace Authorization Details

ZPan defines this RFC 9396 authorization detail type:

```json
{
  "type": "https://zpan.space/authorization-details/workspace",
  "identifier": "workspace-id"
}
```

An authorization request may omit `identifier` to ask the user to choose. The
standalone `/oauth/consent` page lists only workspaces visible to the signed-in
user and can approve one or more of them. A request containing an identifier is
restricted to that workspace and cannot be widened by the consent submission.
The consent page does not change the browser session's active workspace.

The granted array is persisted on the consent, authorization code, access
token, and refresh-token family. It is returned in token responses and appears
as the top-level `authorization_details` claim in JWT access tokens. Refresh
rotation preserves it.

Connected-account clients may request the account-only `workspaces:discover`
scope. Authorization-server metadata advertises both
`authorization_details_catalog_endpoint` and
`authorization_details_catalog_scope`, allowing a generic broker to discover
the required scope and catalog URL without knowing ZPan routes. The catalog
accepts only the connected account's subject Bearer token and returns the
workspace authorization detail plus a safe display label and metadata for the
workspace `type` and current membership `role`. It does not accept Agent target
tokens and grants no access to workspace files or data.

One connected-account subject token may contain multiple approved workspaces.
Each RFC 8693 token-exchange request must select exactly one approved workspace;
the resulting Agent token therefore always has exactly one workspace detail.
The resource middleware rejects a token with zero or multiple workspace
details.

## Pushed Authorization Requests

Clients should send authorization parameters to `/api/auth/oauth2/par` and then
open `/api/auth/oauth2/authorize` with only `client_id` and the returned
`request_uri`. ZPan authenticates the client according to its registration,
stores the request for 90 seconds, strips client credentials from the stored
parameters, and consumes the request URI on first use.

PAR keeps workspace requests, scopes, redirect URI, PKCE challenge, and state
bound to one server-side request while avoiding disclosure in front-channel
URLs. Direct authorization parameters remain supported for compatible clients.

## Consent and Revocation

Consent is keyed by signed-in user and registered client. It contains the
approved scopes and workspace details. Re-consent updates that single grant.
The OAuth Apps settings page lists all approved workspaces and scopes.

Revoking a grant deletes its access tokens, revokes its live refresh-token
families, and deletes the consent. Revoking an exchanged JWT records its JTI
until expiry so the resource server rejects it immediately.

## Agent Token Exchange

The external-resource flow uses three credentials:

1. The user-approved subject token represents the connected account and may
   contain multiple workspaces.
2. A signed JWT bearer assertion mints a short-lived actor token identifying the
   Agent platform actor.
3. RFC 8693 token exchange combines both credentials, the requested scopes, the
   exact `/api` resource, and exactly one workspace authorization detail.

The exchanged JWT contains standard issuer, subject, audience, client, scope,
expiry, JTI, actor (`act`), confirmation (`cnf`), and
`authorization_details` claims. API requests use the DPoP authorization scheme
and a proof bound to the request method, URL, and access token.

## Scope and Role Enforcement

All ZPan resource routes use canonical `<resource>:<action>` scopes. The OAuth
server advertises every grantable canonical scope. Permanent object purge stays
outside user-delegated OAuth grants; it remains a separately constrained
operation.

Possessing a scope does not bypass role checks. For example, a token with a
write scope still needs editor access to the selected workspace, and a token
calling a site-admin operation must belong to a current site administrator.
Roles are read at request time so membership or administrator changes take
effect without waiting for token expiry.

## Direct Upload

File bytes continue to travel directly to S3-compatible storage through
presigned URLs. An Agent creates an object draft, follows the returned upload
descriptor, retains part ETags, and completes the upload. If quota is
insufficient, the normal create-object response is an x402 payment challenge;
after capacity purchase the Agent repeats the same request and continues the
upload.

The upload workflow is described by stable OpenAPI operation IDs and the Arazzo
document. Presigned storage URLs are short-lived bearer capabilities and must
not be logged or persisted in connection state.

## Acceptance

The integration is complete when an external Agent controller can:

1. discover the protected resource, authorization server, scopes, and PAR;
2. dynamically register a client;
3. push a rich authorization request and display standalone consent;
4. receive and refresh a multi-workspace subject grant;
5. exchange it for a one-workspace DPoP Agent token;
6. discover and call any permitted API operation through standard OpenAPI
   security declarations;
7. handle quota exhaustion, x402 payment, upload completion, and download URL
   retrieval;
8. lose access after consent, token, membership, or role revocation.
