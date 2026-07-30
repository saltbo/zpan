# External Agent Access — Design

> Status: Implemented
> Scope: dynamic OAuth clients, external resource authorization, DPoP, resource
> discovery, consent, revocation, and direct uploads

## Decision

ZPan is an OAuth protected resource and authorization server. An Agent platform
such as FlareAuth discovers ZPan from its public API URL, dynamically registers
itself, asks the user for delegated access, and exchanges the resulting subject
grant for a DPoP-bound ZPan resource token.

ZPan does not ship or require:

- a fixed first-party Agent OAuth client;
- an Agent-specific API key;
- Restish credential profiles in OpenAPI;
- a Restish upload plugin;
- a ZPan-specific Agent skill.

The integration contract is the public protocol surface: OAuth metadata,
OpenAPI, route authorization metadata, and structured API responses.

## Discovery

Given the exact resource URL `https://zpan.example/api`, a client can discover:

| Contract | Path |
|---|---|
| API, OpenAPI, and workflow discovery links | `/api` |
| OpenAPI | `/api/openapi.json` |
| Arazzo workflows | `/api/workflows.arazzo.json` |
| Protected resource metadata | `/.well-known/oauth-protected-resource/api` |
| Authorization server metadata | `/.well-known/oauth-authorization-server/api/auth` |
| Dynamic client registration | `/api/auth/oauth2/register` |

Protected-resource metadata identifies the exact `/api` audience and the
authorization server. Authorization-server metadata advertises authorization
code, refresh token, JWT bearer, token exchange, dynamic registration, and
DPoP capabilities.

OpenAPI remains tool-neutral. It contains no `x-cli-config`, built-in client ID,
credential environment variable, or executable helper. Agent-callable
operations publish their exact runtime requirements through `x-zpan-auth`.
`GET /api/oauth-resource-scopes` is a public scope catalog whose OpenAPI
operation carries the standard OAuth scope declaration used by external
resource registries. Keeping the business operations themselves unbound avoids
selecting a built-in Restish OAuth profile before a delegated-credential hook
can provide the resource token. Browser and administration operations retain
their normal cookie/bearer declarations.

The API resource response publishes OpenAPI through an RFC 8631 `service-desc`
link and its Arazzo 1.1 description through a typed `describedby` link. The
OpenAPI document also links the Arazzo document through `externalDocs`. A
controller can therefore discover both contracts from the exact resource URL
without assuming a ZPan-specific path.

The Arazzo document defines separate prepare, re-presign, complete, and abort
workflows backed by stable OpenAPI operation IDs. Preparing an upload returns
the runtime descriptor for the direct storage transfer. This split is
intentional: an Arazzo operation target comes from its source OpenAPI server,
while a presigned storage URL is an arbitrary absolute URL generated at
runtime. The controller executes those PUT requests from the returned
descriptor, then supplies their ETags to the completion workflow.

## Dynamic Registration and Administration

The OAuth provider accepts RFC 7591-style dynamic client registration with PKCE.
Each controller registers its own:

- client name and URI;
- callback URI;
- grant and response types;
- token endpoint authentication method;
- JWKS or JWKS URI when JWT bearer exchange is used;
- requested scopes.

The server assigns the client ID. No client identity or callback is hard-coded
in ZPan.

Administrators can inspect dynamically registered applications in the existing
authentication settings. This first version does not add application approval:
registration is immediately usable, but user consent is still mandatory before
workspace access is granted. System/reference clients are not presented as
external registered applications.

## Consent and Workspace Binding

Authorization code + PKCE creates a user-controlled subject grant. The consent
page resolves the registered client record and displays its real name, callback,
requested scopes, ZPan instance, selected workspace, and grant lifetime.

Each consent is bound to:

- the signed-in user;
- the dynamically registered client;
- exactly one workspace;
- the approved ZPan resource scopes.

The request cannot replace that workspace with a query or body field. Team
membership and role checks still apply. Revoking a consent removes its access
tokens, revokes its refresh tokens, and deletes the consent. The Agent Access
page lists the real client name and workspace for every current-user grant.

## External Resource Token Flow

FlareAuth-style controllers use three credentials with separate purposes:

1. A user-approved ZPan subject token represents the connected account.
2. A JWT bearer assertion identifies the Agent/controller actor and mints a
   short-lived actor token.
3. OAuth token exchange combines subject and actor tokens for the exact ZPan
   `/api` audience and requested scopes.

The exchanged access token is a JWT containing the user, workspace,
`zpan_actor`, delegated actor (`act`), audience, scopes, client ID, expiry, and
JTI. API requests use `Authorization: DPoP` plus a proof bound to the method,
URL, access token, and Agent key. ZPan verifies issuer, audience, signature,
expiry, scopes, DPoP proof, and JTI revocation.

Revoking an exchanged JWT stores its JTI until token expiry. The resource API
rejects revoked tokens. Opaque-token compatibility and fixed-client grant
assertions are intentionally not part of this path.

## Scope Model

Resource scopes use stable `<resource>:<action>` names. The external Agent scope
catalog includes:

| Scope | Authority |
|---|---|
| `objects:read` | List, inspect, and download objects |
| `objects:create` | Create folders and direct-upload sessions |
| `objects:update` | Rename, move, and copy objects |
| `objects:delete` | Soft-delete objects |
| `shares:read` | Inspect shares |
| `shares:create` | Create public shares |
| `shares:delete` | Revoke shares |
| `quota:read` | Inspect workspace quota |
| `storage-usage:read` | Inspect workspace storage usage |
| `tasks:read` | Inspect task state |

Administrative, billing, credential-management, WebDAV, downloader bootstrap,
and purge authority are not grantable through this catalog.

OAuth is a credential adapter, not a business-logic fork. Middleware resolves a
protocol-neutral principal, bound workspace, scope set, and audit actor before
calling the same file use cases used by other authenticated clients.

## Self-Describing Direct Upload

File bytes continue to bypass ZPan and go directly to S3-compatible storage.
The create-object response is the upload workflow contract; an Agent does not
need a plugin or skill to infer hidden follow-up steps.

The response includes:

- upload ID and object draft;
- ordered part descriptors with part number, byte offset, byte length, method,
  presigned URL, and required headers;
- a `workflow` object describing the upload request;
- the exact complete, re-presign, and abort operation IDs, methods, and paths;
- instructions to preserve each upload response ETag and submit
  `{ partNumber, etag }` to completion.

An Agent follows this generic sequence:

1. Call `createObject` with file name, size, type, and workspace context.
2. Split the local file according to each returned `offset` and `length`.
3. `PUT` each byte range to its returned presigned URL and retain the response
   ETag.
4. If a URL expires, call the returned re-presign operation for only the
   unfinished part numbers.
5. Call the returned complete operation with all part numbers and ETags.
6. On an intentional cancellation, call the returned abort operation.

Presigned URLs are bearer capabilities with short lifetimes. They must not be
logged, cached in checkpoints, or sent through the controller. Completion and
re-presigning re-enter ZPan authorization and workspace checks.

## Compatibility Boundary

The legacy `zpan-cli` device flow remains limited to downloader registration.
Ordinary human-created API keys remain available for their existing product
uses, but there is no Agent API-key template or Agent key management UI.

Future client-registration approval can be added around dynamically registered
client records without changing resource discovery, consent, token exchange,
OpenAPI, upload responses, or file use cases.

## Acceptance

The integration is complete when a generic FlareAuth/Restish controller can:

1. discover ZPan from `/api`;
2. dynamically register and appear in administrator settings;
3. create a user-visible authorization request;
4. obtain a DPoP resource token after consent;
5. discover file operations from OpenAPI and upload workflows from Arazzo;
6. upload bytes and complete the upload using the Arazzo and returned runtime
   workflow data;
7. list, read, and rename the resulting object;
8. lose access after grant or JWT revocation.
