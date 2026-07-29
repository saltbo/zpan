# Agent Authentication and Authorization — Design

> Status: Proposed (2026-07-28)
> Scope: Agent OAuth, API keys, workspace grants, protocol-neutral
> authorization, Restish profiles, future Agent Auth compatibility, revocation,
> and auditing

## 1. Decision

ZPan distinguishes delegated user access from unattended service access:

| Actor | Authorization flow | Runtime credential |
|-------|--------------------|--------------------|
| Interactive Agent, local callback | Authorization code + PKCE | OAuth access/refresh tokens |
| CI or unattended service | Manual issuance | Workspace-scoped Agent API key |

This follows the current FlareAuth Restish v2 design: standard OpenAPI OAuth
metadata and `x-cli-config` let Restish connect, authorize, cache, refresh, and
revoke local tokens without a custom authorization script.

Standard Agent device authorization is deferred to v2.9.x. The existing
`zpan-cli` device flow remains a narrowly scoped compatibility bootstrap for
downloader registration and does not manufacture an Agent API key or a general
OAuth grant.

Anonymous upload and preview-and-claim are explicitly excluded. Every Agent file
operation belongs to an existing user-authorized workspace from the beginning.

OAuth and API keys are v2.9 credential adapters, not the file API's identity
model. Both resolve to a protocol-neutral principal, scope set, fixed workspace,
and audit actor. A future Agent Auth verifier plugs into that same boundary.

## 2. Why OAuth for Interactive Agents

Interactive Agents act on behalf of a signed-in human. OAuth gives that
relationship first-class semantics:

- short-lived access tokens
- refresh-token rotation and revocation
- explicit client identity
- explicit resource scopes
- browser consent
- authorization code + PKCE for public native clients
- no browser-cookie or raw-token copy/paste

Restish v2 natively supports authorization code + PKCE. It caches OAuth tokens
separately from HTTP responses, refreshes them, retries once after a `401`, and
supports explicit logout.

## 3. Why API Keys Still Exist

CI and unattended services are different: no human is present to complete
consent or periodically reauthorize. The existing Better Auth API-key
foundation already supplies:

- hashed credential storage
- named and independently revocable keys
- expiry and enabled state
- rate-limit state
- resource/action permissions
- workspace scope in metadata
- owning user reference
- per-key audit attribution

An Agent API key is therefore the pragmatic v2.9 service credential. It is
created manually and stored in a CI secret. Future workload identity federation
can replace it without changing the canonical scope and policy model.

## 4. Stable Upgrade Boundary

ZPan separates four concepts:

| Concept | Responsibility |
|---------|----------------|
| Credential adapter | Validate OAuth, API key, or future Agent JWT |
| Principal | Identify the authorizing user, credential actor, and fixed workspace |
| Scope and policy authorization | Intersect credential scopes with current workspace authority |
| Use case | Perform the file operation without knowing the credential protocol |

Conceptually, an Agent-facing principal contains:

```ts
type AgentPrincipal = {
  kind: 'delegated-user' | 'service' | 'agent'
  userId: string
  orgId: string
  scopes: ReadonlySet<Scope>
  actor: {
    type: 'agent_oauth' | 'api_key' | 'agent'
    id: string
  }
}
```

The exact TypeScript representation may remain a discriminated union, but
routes must authorize scopes rather than require a concrete `kind`.
Credential-specific fields remain available for diagnostics and revocation;
they do not select business behavior.

This boundary deliberately avoids two migration traps:

- File routes must not treat an OAuth bearer as an unrestricted browser user.
- Agent API keys must not become ZPan's proprietary Agent identity,
  registration, signing, or capability-grant protocol.

With this boundary, adopting Agent Auth later adds a verifier, persistence,
approval UI, and management UI. It does not change operation IDs, the unified
OpenAPI document, Skill/plugin workflows, workspace authorization, or file use
cases.

## 5. System-Managed OAuth Client

Create a built-in public native application such as `zpan-agent`.

Properties:

- system-managed and not editable/deletable
- public client; no client secret
- authorization code grant with PKCE
- loopback redirect URI such as `http://localhost:8484/callback`
- refresh-token support through `offline_access`
- Agent scopes only

Dynamic client registration is not required in v2.9. One first-party client is
enough for the versioned ZPan Skill and Restish integration.

The authorization server publishes discovery metadata. Clients must discover
authorization, token, revocation, and user-info or introspection endpoints
rather than hard-code them.

## 6. Workspace Grant

OAuth scopes describe allowed operation classes, but a ZPan grant also needs a
resource boundary: exactly one workspace.

The consent record binds:

- authorization/grant ID
- user ID
- OAuth client ID
- workspace `orgId`
- approved scopes
- created, expiry, revoked, and last-used state

Access/refresh tokens resolve to that grant. The API does not derive workspace
from the user's mutable active-organization session.

Effective authorization is:

```text
credential is valid
AND grant/key allows the requested action
AND request targets the bound workspace
AND authorizing user still has the required workspace role
```

For a team workspace, relevant requests recheck current membership and role.
Removing the user or reducing their role immediately reduces Agent access.

For a personal workspace, authorization verifies that the organization is the
authorizing user's personal organization. The current API-key branch in
`requirePermission` lacks this personal-ownership fallback and must add it.

Request bodies and query parameters cannot override the credential's workspace.
A mismatch is `403`, never a fallback to another active or personal workspace.

## 7. Scope Model

ZPan defines one canonical authorization vocabulary for scoped credentials.
OAuth grants, Agent API keys, and future Agent credentials resolve to the same
scope set. A browser cookie is a first-party, unbounded credential: it does not
need a role-to-scope mapping, but it still passes the route's declared
workspace, minimum-role, ownership, and resource policies. There is no
separately named permission vocabulary and no `Scope -> Permission` mapping.

Scope names follow:

```text
<resource>:<action>
```

Rules:

- lowercase ASCII only;
- plural domain resource names such as `objects`, `shares`, and `tasks`;
- a small shared action vocabulary such as `read`, `create`, `update`, and
  `delete`;
- business operations rather than HTTP methods;
- no wildcard semantics or access implied by string prefixes;
- no `zpan:` prefix, because token issuer and audience already identify the
  ZPan API;
- published scope meanings are stable and must never silently broaden.

Initial Agent-grantable scopes are:

| Scope | Intended operations |
|-------|---------------------|
| `objects:read` | List, inspect, and download objects |
| `objects:create` | Create folders, upload drafts, upload-part signatures, and complete uploads |
| `objects:update` | Rename, move, and copy objects within the authorized workspace |
| `objects:delete` | Soft-delete objects |
| `shares:read` | List and inspect shares |
| `shares:create` | Create public shares |
| `shares:delete` | Revoke shares |
| `quota:read` | Inspect workspace quota |
| `tasks:read` | Inspect task state |

Protocol scopes such as `openid` and `offline_access` retain their standard
OAuth/OIDC meaning. They are not ZPan route permissions.

Every protected route declares the minimum scopes required to perform its
operation. It does not enumerate the roles, presets, credential types, broad
scopes, or Agent classes allowed to call it. For example:

```ts
auth: {
  allOf: ['objects:delete'],
  workspace: 'required',
}
```

Scope authorization is necessary but not sufficient. Workspace membership,
resource ownership, resource state, quota, and other request-specific
constraints remain explicit policy checks.

The consent and API-key UIs can present Reader, File manager, and Publisher
shortcuts. A shortcut expands to an explicit set of scopes; it is not itself a
scope, and routes never reference its name. Destructive and public-sharing
scopes remain separately selectable.

No Agent-grantable scope implies admin, billing, entitlement, membership,
credential management, WebDAV, image-hosting configuration, or downloader
registration. Those protected APIs still use the same route scope mechanism but
are excluded from the Agent credential grant policy.

## 8. Authorization Code + PKCE

This is the default Restish flow:

1. Skill identifies and confirms the ZPan origin and Restish API name.
2. Skill requires Restish v2.
3. `restish api connect` discovers `/api/openapi.json` and applies its
   server-published OAuth binding.
4. The first safe Agent operation starts browser authorization.
5. Restish creates a PKCE verifier/challenge and listens on its loopback
   callback.
6. User signs in, selects one workspace, reviews scopes, and approves or denies.
7. Restish exchanges the authorization code and caches the tokens.
8. Later commands refresh tokens without exposing them to the Agent response.

The consent page displays the Agent client, instance hostname, workspace,
requested scopes, destructive/public side effects, and grant lifetime.

Restish's `--rsh-no-browser` may be used when a browser cannot be opened but the
authorization-code callback can still be completed manually.

## 9. Deferred Agent Device Authorization

Standard Agent device authorization is a v2.9.x follow-up. It must issue tokens
for the same workspace grant and scope model as authorization code + PKCE, not a
broad Better Auth session token. The existing Better Auth device plugin remains
restricted to the legacy `zpan-cli` downloader bootstrap until that follow-up.

## 10. Agent API-Key Issuance

Manual API-key creation is the initial CI path:

1. User opens Agent Access settings.
2. User selects a workspace.
3. User names the Agent or environment.
4. User selects permissions and expiry.
5. Server verifies current authority and creates an `agent` API key.
6. The plaintext key is shown once.

New Agent keys never use `scope.mode = "user-workspaces"`. One key authorizes one
workspace. Expiry is required, defaults to 90 days, and cannot exceed one year.
Use one key per CI environment.

The UI lists name, workspace, permission summary, creation, expiry, last use,
and status. Revocation is immediate. Rotation creates a new key and never
reveals or mutates the old secret.

## 11. OpenAPI and Restish v2 Binding

ZPan publishes one unified `/api/openapi.json`. It defines:

- relative server URL for Agent API routes
- OAuth authorization-code security scheme with Agent scopes
- Bearer alternative for Agent API keys
- stable operation IDs and structured errors
- document-level Restish v2 `x-cli-config` profiles

Conceptual configuration:

```yaml
components:
  securitySchemes:
    agentOAuth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: /api/auth/oauth2/authorize
          tokenUrl: /api/auth/oauth2/token
          scopes:
            objects:read: Read files and folders
            objects:create: Upload files and create folders
            objects:update: Rename, move, and copy files and folders
            objects:delete: Delete files and folders
    agentApiKey:
      type: http
      scheme: bearer

x-cli-config:
  profiles:
    default:
      credentials:
        agentOAuth2:
          params:
            client_id: zpan-agent
            scopes: openid offline_access objects:read quota:read
            redirect_path: /callback
    file-manager:
      credentials:
        agentOAuth2:
          params:
            client_id: zpan-agent
            scopes: openid offline_access objects:read objects:create objects:update objects:delete quota:read tasks:read
            redirect_path: /callback
```

The real document also provides a Publisher shortcut. Reader is the default, so
connecting the API does not silently request write or share permission. These
profile names only expand to explicit scopes; routes never reference them.

A separate environment-backed profile selects `agentApiKey` for CI. No Agent
device-code profile is published in v2.9.

The OpenAPI document never contains credentials or configures an executable
credential helper. Skill instructions select a named Restish profile rather
than assuming OAuth or a particular environment-variable name. This keeps
operation workflows unchanged if a future local profile uses an Agent Auth
signer.

All formal API operations remain visible to Restish CLI generation. Declared
scopes and dynamic policy decide whether a credential may call them. Only
browser callbacks and internal-only endpoints are hidden from CLI generation.
MCP additionally ignores authentication, administration, and credential
management operations and keeps write tools disabled by default. ZPan does not
maintain a second Agent operation allowlist.

## 12. Restish Upload Plugin

`restish-zpan` is a Restish v2 command plugin shipped from this repository. It
contributes `restish zpan-upload` and is installed with:

```sh
restish plugin install saltbo/zpan zpan
```

The plugin uses Restish delegated HTTP for ZPan draft, part re-sign, complete,
and abort operations, preserving the selected profile, OAuth/API-key
authentication, TLS, and normalized output. It streams local file sections
directly to presigned S3 URLs with bounded concurrency, retry, ETag capture,
resume checkpoints, and idempotent completion.

The plugin never asks Restish for authentication secrets. Checkpoints contain
only safe API/profile identity, upload session and file identity, and completed
part/ETag state; they contain no token, cookie, API key, or presigned URL. The
Skill invokes this command and never implements multipart state itself.

## 13. Route Authorization

Both credential types enter a shared Agent authorization boundary.

For OAuth:

1. validate/introspect the access token;
2. require the built-in Agent client ID and the route's required scopes;
3. resolve user and fixed workspace grant;
4. recheck current workspace authority.

For API keys:

1. verify key, expiry, revocation, rate limit, and owner status;
2. require `configId = "agent"` and the route's required scopes;
3. resolve fixed workspace metadata;
4. recheck current workspace authority.

Both then invoke the same use case with the fixed `orgId` and a typed audit
actor. Routes use shared permission middleware instead of session-only or
principal-specific checks. The shared middleware accepts the internal principal
contract, so tests for protected operations do not need to know how the
principal authenticated.

Special considerations:

- A presigned upload URL may remain usable briefly after credential revocation
  because S3 validates the signature independently. Keep presigned lifetimes
  short.
- Upload completion and new part presigning always reauthorize.
- Issuing a new download URL requires object-read permission.
- Listing and task responses remain workspace-filtered and paginated.
- Share creation requires `shares:create` even when the Agent can read the
  object.

## 14. Audit and Management

Audit records distinguish resource ownership from the actor that initiated the
operation. OAuth actions record an `agent_oauth` actor with grant/client
attribution. API-key actions retain `api_key` with the key ID as `actorRef`.
Both record the authorizing user, workspace, action, target, outcome, and safe
metadata. A future Agent Auth adapter records `agent` with its Agent ID while
retaining the delegated user as resource owner.

Agent Access settings show two sections:

- delegated OAuth grants, with client, workspace, scopes, last use, and revoke;
- service API keys, with name, workspace, permissions, expiry, last use, and
  revoke/replace.

Revoking a delegated grant invalidates its refresh tokens and prevents new
access tokens. Short access-token lifetime bounds any validation-cache delay.
`restish api auth logout` clears local cached tokens; server-side revoke remains
available when a device is lost.

Credentials are never recorded or redisplayed.

## 15. Current Code Gaps

- ZPan has bearer sessions and device authorization but is not yet an OAuth
  authorization server with Agent resource scopes and workspace grants.
- Device authorization validates only `zpan-cli` and currently yields a
  user-oriented bearer token.
- `shared/api-key-templates.ts` lacks an Agent template.
- `server/http/objects.ts` rejects ordinary API-key principals.
- authenticated shares, quota, trash, and several task routes require a user
  session instead of a permission.
- the current principal model and `requireAuth` helper encourage routes to
  branch on identity kind; all protected routes need shared scope declarations
  and a protocol-neutral authorization boundary.
- API-key authorization needs the personal-workspace ownership check.
- the unified OpenAPI document lacks operation security and CLI/MCP annotations;
- the current upload contract lacks explicit part descriptors, robust re-sign,
  expiry, idempotent completion, and a Restish command plugin.

These authorization-boundary changes require integration tests for OAuth and
API-key success, missing scope/permission, wrong workspace, wrong client, role
reduction, expiry, revocation, and personal/team spaces.

## 16. Agent Auth Protocol Compatibility

The [Agent Auth Protocol](https://agentauthprotocol.com/) is a strong long-term
fit because it gives every Agent a cryptographic identity, scoped capability
grants, an independent lifecycle, and per-Agent audit attribution. The
[Better Auth Agent Auth plugin](https://better-auth.com/docs/plugins/agent-auth)
also provides discovery, device/CIBA approval, short-lived signed JWTs, replay
protection, OpenAPI/MCP adapters, and lifecycle events.

It is not the required v2.9 production path:

- the protocol is currently `v1.0-draft`, and the plugin documentation marks
  the implementation as unstable;
- Restish does not natively implement Agent Auth request signing;
- production Cloudflare Workers need distributed JTI replay storage rather than
  the plugin's default in-memory cache;
- custom REST `location` handlers must validate grants and constraints in the
  shared authorization layer;
- converting the full ZPan OpenAPI document into capabilities would expose too
  much surface.

The intended future adapter is:

```text
Agent Auth JWT
  -> verify signature, audience, expiry, and JTI
  -> resolve delegated user and approved workspace
  -> normalize capability grants to the canonical Scope set
  -> create protocol-neutral principal and `agent` audit actor
  -> run existing scope and policy middleware and use case
```

The effective permission remains:

```text
Agent Auth capability grant
AND authorizing user's current workspace role
AND request targets the approved workspace
AND resource-specific policy allows the operation
```

Expected change surface:

| Remains unchanged | Added for Agent Auth |
|-------------------|----------------------|
| Unified OpenAPI and operation IDs | Agent/host/grant/approval persistence |
| ZPan Skill and upload-plugin workflows | Agent JWT credential adapter |
| File, share, quota, and task use cases | Approval and Agent-management UI |
| Route scope requirements and workspace policies | Distributed JTI replay storage |
| Presigned direct-to-S3 upload sequence | Restish signing profile/helper |

Agent Auth does not replace role, quota, storage, share, or ownership checks.
Autonomous/anonymous Agent registration and later claim are outside the current
product boundary; an initial integration supports delegated Agents only.

Restish remains the operation client. Until it supports Agent Auth natively, a
future profile may use its
[external-tool authentication](https://rest.sh/docs/recipes/use-external-tool-auth/)
to invoke the official Agent Auth client or a minimal reviewed signer. This is
an authentication adapter, not a standalone ZPan CLI. The unified OpenAPI
operations and Skill workflows remain unchanged.

Before promotion from preview to the default interactive flow, require:

- a maintained Restish signing integration or native Agent Auth support;
- distributed JTI replay protection on Workers and an equivalent Node path;
- cross-runtime tests for registration, approval, execution, replay, revoke,
  role reduction, and workspace isolation;
- an explicit Agent-grantable scope catalog rather than automatic authorization
  for every operation in the unified OpenAPI document;
- acceptable upstream protocol and package stability.

## 17. Rejected Alternatives

### Device Approval Mints an API Key

Rejected because device approval must eventually issue the same delegated OAuth
grant as authorization code + PKCE. Minting an API key would replace that
short-lived and refreshable lifecycle with a proprietary exchange.

### API Key for Every Agent

Rejected because interactive user delegation benefits from consent, short access
tokens, refresh-token revocation, and client identity. API keys remain
appropriate for CI and unattended services.

### OAuth for CI by Pretending a User Is Present

Rejected because unattended automation should not depend on a human refresh
grant. Use a scoped API key until workload identity federation is available.

### Agent Auth as the Only v2.9 Credential

Deferred because the protocol and current plugin remain unstable and Restish
needs an external signer. The compatibility boundary is included now;
production adoption can follow without making v2.9 depend on a draft protocol.

### Browser Cookies

Rejected because they are broad, mutable user-session credentials and unsafe to
copy into Agent environments.

### One Credential Across All User Workspaces

Rejected because it makes compromise impact, audit interpretation, role changes,
and revocation unnecessarily broad.

### Anonymous Upload and Claim

Deferred outside v2.9. File storage normally implies persistence and an
accountable quota owner. Revisit only if ZPan deliberately builds a
try-before-login artifact-delivery product.

## 18. Future Evolution

- Better Auth Agent Auth compatibility adapter, initially behind a feature flag
- Delegated Agent approval and per-Agent revoke/management UI
- Distributed JTI and Agent-key cache storage for Cloudflare Workers
- Workload identity federation for supported CI providers
- Dynamic client registration for trusted third-party Agent platforms
- Standard Agent device authorization using the same workspace grant and scopes
- Rich Authorization Requests if third-party clients need standardized
  workspace selection in the authorization request
- HTTP Message Signatures / Web Bot Auth for additional Agent-operator
  attribution, never workspace authorization
