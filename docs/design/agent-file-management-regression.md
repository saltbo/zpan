# Agent File Management Regression Log

This document records end-to-end regressions for Agent-driven ZPan file management across Realmroot, Restish, ZPan, ZPan Cloud, and a discovered x402 payer. A round only passes when the Agent can discover state, connect accounts, request workspace-scoped access, switch workspaces, and manage files through the Realmroot skill and CLI.

## Final outcome

- Local: repeated file-management boundary rounds, a complete x402 purchase/upload continuation, and two independent skill-only cleanroom acceptances passed.
- Staging: two-workspace file management and sandbox-payer x402 settlement/upload continuation passed through public APIs.
- Production: two-workspace file management passed after deployment; production payment was intentionally excluded.
- Runtime contract: an Agent can discover resources and real workspace contexts, connect or expand an account, obtain one exact workspace-bound token at a time, switch workspaces without a custom header, manage files, and recover from insufficient capacity through the advertised x402 purchase operation.
- Cleanup: counted fixtures and shares were deleted or revoked. Controller-approved persistent cleanroom grants remain active because grant revocation is a controller-management operation, not an Agent self-service operation.

## Acceptance constraints

- Agent-side work uses only the Realmroot skill and CLI.
- Database inspection and source-code investigation are not valid runtime diagnostics.
- Browser automation is allowed only to simulate the human controller approving a request.
- A target token represents exactly one workspace; callers do not select a workspace with a custom header.
- Routine resources use generic Restish HTTP commands. Dedicated commands are reserved for client-side orchestration.
- The default Restish profile targets production. Other environments use explicit `local` and `staging` profiles.
- Cross-workspace transfer is optional. File management inside each selected workspace is mandatory.

## Issues

| ID | Area | Symptom | Expected behavior | Status |
| --- | --- | --- | --- | --- |
| AFM-001 | Realmroot plugin | Creating a resource connection returns a pending response but does not open the controller page or wait. | The response middleware opens the same-origin approval URL, polls authorization contexts, and returns the connected result. | Fixed; local debug regression passed |
| AFM-002 | Realmroot plugin/runtime | Workspace access request orchestration exists in source, but the installed plugin returned immediately instead of opening and waiting. | The locally installed binary must match the tested source and perform foreground approval orchestration. | Fixed by rebuilding/reinstalling; local debug regression passed |
| AFM-003 | Realmroot API/plugin | A resource connection request has no Agent-readable request endpoint. | The plugin must still complete the positive flow without a new command or database lookup. | Resolved by polling the existing authorization-context resource; denial resolves by expiry |
| AFM-004 | Restish profiles | Realmroot uses `local`, while ZPan's local target was previously the unnamed default profile. | Default targets production; `local` and `staging` are explicit profiles for every API. | Fixed in skill/template guidance and local configuration; runtime check passed |
| AFM-005 | Realmroot plugin | A stale cached target token reached ZPan and produced an opaque `401 Unauthorized`. | Invalidate the credential on 401; the command must stop with an actionable reissue instruction and never silently retry with invalid state. | Fixed and covered by plugin tests |
| AFM-006 | Dynamic registration | A manually rotated client connected successfully but could not mint target tokens because JWT Bearer, Token Exchange, JWKS, and authorization-detail metadata were missing. | Dynamic registration and rotation are owned by Realmroot and always publish the complete client contract. | Fixed; fresh-identity and workspace-token regressions passed |
| AFM-007 | Error quality | ZPan's 401 hid the credential-layer failure behind a generic target response. | Plugin credential failures are surfaced directly with no secret material. | Fixed for cached-token rejection and acquisition failures |
| AFM-008 | File management | Baseline single-file upload required no source or database investigation and returned a valid download URL. | Create, direct upload, complete, read, and download verification remain self-described by OpenAPI. | Passed round 0 |
| AFM-009 | Realmroot plugin | The first target-token command printed the raw `accessToken` despite source-level redaction. | Store the token in protected plugin state, suppress the token response, and fail closed for an unrecognized token response. | Fixed for the skill path; explicit structured output now exits zero with no output |
| AFM-010 | ZPan workspace setup | Creating the second team displayed “Team limit reached” and left the dialog open even though the organization and owner membership were committed. | A failed response must not commit the workspace, or a successful commit must return success and refresh the switcher. | Open; fixture exists, outside counted Agent rounds |
| AFM-011 | Test isolation | A concurrent Restish process from another local ChatGPT session created a different workspace access request while Round 1 was waiting. | Counted rounds must run without other approval workflows sharing the same local Realmroot controller/browser state. | Environment issue; Round 1 invalidated and will be rerun in isolation |
| AFM-012 | Realmroot/ZPan account reauthorization | Reauthorizing an account after provider-side dynamic-registration drift either failed with `invalid_scope` or revoked still-covered workspace grants when the OAuth client generation changed. | Realmroot must repair RFC 7592 provider drift and retain every grant still covered by the replacement connection's scopes and authorization details. | Fixed in Realmroot; live drift repair and covered/uncovered grant regressions passed |
| AFM-013 | Restish raw output | Redirected default output bypasses response middleware and prints the original target-token response. | The Realmroot skill must force a structured formatter for secret-bearing orchestration; the plugin then stores the token and suppresses all output. | Mitigated in the skill; upstream Restish behavior is intentionally unchanged |
| AFM-014 | Realmroot skill/RAR | The access-request example did not show where a concrete workspace authorization detail belongs, so an Agent could put it inside `target` and receive `invalid_authorization_details`. | Copy the exact catalog item into the top-level `authorizationDetails` array and request exactly one workspace. | Fixed in skill guidance; cleanroom retry passed |
| AFM-015 | Test isolation | A shared plugin state directory allowed another local Agent workflow to replace the active one-workspace target credential between otherwise valid commands. | Acceptance uses a dedicated `REALMROOT_PLUGIN_STATE_DIR`; normal behavior remains one active workspace credential per resource URL. | Isolated; cleanroom Round 1 passed without interference |
| AFM-016 | ZPan Cloud setup | A bound Business instance had no capacity catalog or publication, so a quota-exhausted upload ended in `502 not_found` instead of a usable 402 offer. | The instance store must have an active capacity product, verified x402 receiver, and healthy listed publication before paid uploads are advertised. | Resolved in the local environment; publication health passed |
| AFM-017 | ZPan Cloud UI | The first plan save displayed an old `unauthorized` result after the previous binding had been replaced, even though a fresh retry succeeded. | Store mutations must use the current active binding/session and surface current results. | Stale setup state cleared; current binding and retry passed; watch in staging |
| AFM-018 | Local publication | Cloud rejects localhost/private provisioning and health URLs, so a local x402 round cannot be published directly from `localhost:5185`. | Local paid regression uses a public HTTPS tunnel and configures ZPan's public URL before refreshing the bound license. | Resolved by normal public-origin configuration and entitlement refresh |
| AFM-019 | Realmroot account update | An explicit `access connect` returned immediately when any active connection already existed, so an unlinked discovered workspace could never be added and access requests stayed in an `invalid_authorization_details` loop. | A connection-update command must wait until the provider authorization revision actually changes; the Agent then re-reads the catalog and requests the newly authorized workspace. | Fixed, deployed, and verified in staging with a two-workspace expansion |
| AFM-020 | Restish target profiles | The staging target profile contained only `base_url`; target-token issuance succeeded, but Restish reported that the profile had no `oauth2` credential binding and refused every secured target operation. | Every non-default target profile must bind its declared security scheme to `realmroot-target` with the exact selected scopes. | Fixed in local configuration and Realmroot skill guidance; staging operations passed |
| AFM-021 | ZPan Cloud publication UI | A product that became inactive remained selectable from stale query state; saving the resource then returned only `invalid_product_price`. | Refresh or invalidate the product query before editing, exclude inactive products, and identify whether the product or price is invalid. | Fixed in Cloud UI/API; targeted tests and local active-only selector regression passed |
| AFM-022 | Local profile isolation | Omitting `REALMROOT_PLUGIN_STATE_DIR` on one target command silently selected the default Agent's Admin workspace credential instead of the cleanroom Agent's Regression credential. | Every Realmroot and target command in an isolated run must inherit the same plugin state directory; the skill should establish it once for the shell/session. | Fixed in Realmroot skill guidance; the unintended Admin draft was aborted and the isolated paid round passed |
| AFM-023 | x402 payer local profile | The local Restish profile declared only `wallet:x402:pay`, so valid `wallet:read` and `wallet:budget:request` grants were hidden from generated operations. | Local/staging payer profiles must declare the complete supported scope set advertised by the resource. | External profile repaired; the payer contract regression now asserts all three scopes |
| AFM-024 | x402 payer OpenAPI | A sandbox profile reused Restish's one cached production contract, so generated validation omitted Base Sepolia (`eip155:84532`) even though sandbox runtime returned and accepted it. | One semantic payer API with environment profiles needs a profile-stable supported-network schema; endpoint-specific enablement remains in `x-wallet-environment` and runtime policy. | Fixed, tested, deployed, and synced; sandbox help now includes production and sandbox CAIP-2 identifiers |
| AFM-025 | Restish x402 header forwarding | Payer authorization consumed the sandbox budget, but a caller matching `^Payment-Signature:` missed Restish's `< Payment-Signature:` verbose response line, so Cloud correctly remained quoted and no capacity was delivered. | Protocol response headers must be captured with Restish's response prefix, forwarded unchanged, and considered complete only after the merchant succeeds and the payer confirms settlement. | Fixed in Realmroot skill guidance; the same staging attempt subsequently reached delivered/settled |
| AFM-026 | ZPan Cloud webhook idempotency | A paid delivery webhook failed once, then every retry remained pending because local D1 returned an opaque uniqueness error that ZPan's string-matching conflict detector did not recognize. | Claim webhook events atomically with `ON CONFLICT DO NOTHING ... RETURNING`; resume the stored event whenever no row was inserted. | Fixed in ZPan; async/sync/conflict unit tests and store integration tests passed |
| AFM-027 | Realmroot account expansion | A connection update requested only the newly needed scope, so the successful OAuth callback replaced existing account scopes and revoked persistent workspace grants that were no longer covered. | Every connection expansion must request the union of the active account scopes and newly requested scopes; pending/interrupted authorization must not mutate the connection or grants. | Fixed in Realmroot; 49 use-case tests, spec verification, typecheck, and CI passed |
| AFM-028 | Cleanroom fixture | The manually prepared workspace omitted the quota projection and free-plan entitlement rows that normal workspace creation installs, first blocking fulfillment and then downloads with zero traffic authority. | Cleanroom fixtures must be created through the normal workspace path or reproduce all required quota projections and free-plan entitlements before counted acceptance begins. | Test setup repaired; no product behavior was changed |
| AFM-029 | Production resource metadata | Immediately after ZPan production deployment, Realmroot's existing resource registration still reported that no authorization-detail catalog was advertised. | Deployment validation refreshes the public resource contract before asking the Agent to discover contexts, then reauthorizes the existing provider account for the newly advertised catalog scope. | Resolved through the public Realmroot management/resource workflow; production then exposed all four real workspaces |
| AFM-030 | Realmroot generic OAuth connection | The Restish plugin waited for `access connect` by polling an optional authorization-detail catalog, so an ordinary OAuth resource without a catalog failed with 400. | Connection completion is observed through generic Agent resource discovery; context-aware and ordinary OAuth resources use the same protocol path. | Fixed in Realmroot, covered by unit/plugin/E2E tests, CI green, and deployed |
| AFM-031 | Non-interactive approval handoff | A context-isolated Agent's pending access request was created, but redirected plugin stderr remained quiet until the response hook completed, so the Agent interrupted and retried before seeing the approval URL. | Non-interactive runtimes use the plugin's protected approval handoff file while the original command remains in the foreground; interactive terminals continue to receive the URL directly. | Fixed in Realmroot plugin fallback and skill guidance; two live non-TTY requests surfaced one approval URL each without a retry |
| AFM-032 | ZPan RFC 9396 consent | Realmroot correctly expanded one account connection to include all previously authorized and newly requested workspaces, but ZPan PAR and consent context rejected more than one fixed workspace detail despite the documented multi-workspace subject grant. | Authorization-code requests accept one or more unique workspace details; consent locks every fixed workspace, while token exchange remains exactly one workspace. | Fixed in ZPan; focused Node tests, 5,397-test full suite, 81 Workers tests, build, and live three-workspace consent passed |
| AFM-033 | Realmroot generic interaction plugin | A completed connection request was reconstructed as a partial plugin-owned struct, losing `resourceServerId`, `resources`, timestamps, and reason while inventing `credentialOffer: null`. | The plugin reads only generic interaction control fields and returns the complete server-owned representation unchanged unless it consumes a real credential offer into a safe receipt. | Fixed in the generic profile handler and covered by Go tests plus live completed-request readback |
| AFM-034 | Realmroot generated commands | The OpenAPI contract and skill drifted into nonexistent top-level commands and redundant names such as `resource-server servers`. A global Restish override temporarily hid the problem, while the server's unsupported `x-cli-config.command_layout` extension was silently ignored by Restish 2.3.0. | Keep the generated workflow surface to `whoami`, `request-capabilities`, `connect`, and `access`. Discover and read Resource Servers and provider-owned Resources with generic `restish get` against server-returned links; the plugin handles only local identity, interaction, and credential custody. | Fixed in the server OpenAPI contract, skill, plugin, and tests; fresh isolated Restish configuration exercises the four workflow commands plus generic reads without a local command-layout override |
| AFM-035 | Realmroot target credential selection | A stale target-profile issuer caused the auth hook to skip a valid short-lived credential, Restish sent its placeholder authorization value, and the response hook then deleted the credential after the resulting 401. | Target authentication fails before network I/O with an explicit missing-credential or issuer-mismatch error; a 401 clears cached state only when the request actually carried both DPoP authorization and proof. | Fixed in the generic Realmroot plugin with focused Go tests; the local profile now uses the stable local issuer and direct ZPan invocation passed |
| AFM-036 | Realmroot dynamic client repair | An existing provider connection bypassed dynamic-client validation during target credential issuance, so changed callback or JWKS metadata survived until token exchange failed with an opaque `invalid_grant`. | Validate the complete security-relevant RFC 7592 registration metadata before issuing with the current client generation, repair drift through the provider registration endpoint, and require reauthorization only when repair rotates the generation. | Fixed in Realmroot with connector and external-resource use-case coverage; the clean local credential flow passed after automatic repair |
| AFM-037 | ZPan trash purge authorization | Soft-delete worked through OAuth, but permanent purge declared only bearer/cookie security and excluded `objects:purge` from the OAuth resource scope catalog, leaving an Agent unable to complete cleanup through the same authorization model. | Every file-management permission is an OAuth scope independent of authentication mechanism; purge advertises OAuth, bearer, and cookie alternatives and is requestable through normal Resource access. | Fixed in ZPan OpenAPI, authorization metadata, consent labels, translations, and tests; isolated cleanroom obtained an exact short-lived purge credential, but the named fixtures were already absent so no unsafe purge was attempted |
| AFM-038 | Installed Realmroot skill artifact | The independent Agent initially read a previously installed Skill release whose discovery example still used removed `/agent/api-resources`, while the implementation-under-test Skill source already documented `/api/resource-servers`. | Acceptance must load the Skill artifact from the same version under test; releases must publish server, plugin, and Skill contract changes together. | Cleanroom rerun pinned to the updated Skill source; release packaging remains a deployment responsibility |
| AFM-039 | Durable grant reuse | Resource discovery aggregated the scopes of active durable grants, but access creation reused only an exactly equal scope set. An Agent requesting one operation's narrower scope therefore saw `authorizedScopes` and was still sent through redundant controller approval. | A persistent or time-bounded grant authorizes every scope subset for the same Agent, connection, Resource Server, and provider-owned Resource. Each access request still produces an exact, short-lived credential containing only the requested subset; one-token grants remain exact and single-use. | Fixed in Realmroot access creation and issuance; a live two-scope subset of a broader workspace grant returned `ready` without interaction and the credential receipt contained exactly those two scopes |
| AFM-040 | Acceptance environment profiles | Local and staging acceptance initially relied on profile names as though they were part of the public API contracts. They are actually machine-local deployment aliases. | Realmroot and ZPan publish only the external user's `default` profile. Acceptance config creates any `local` or `staging` aliases locally and reuses the contract's generic credential binding without exposing those environments to external users. | Corrected in both OpenAPI contracts and covered by focused assertions that the public templates contain only `default` |
| AFM-041 | Restish scope-catalog refresh | Restish preserves an existing profile's explicit `satisfies` values when `api sync` loads a Resource Server contract containing a newly added scope. Operation readiness can then reject the new scope before the Realmroot auth hook runs. | Realmroot's plugin cannot repair a decision made before plugin invocation. Fresh API connections receive the complete server-owned scope catalog; evolving existing profiles requires upstream Restish support to merge server-owned credential metadata safely. | Confirmed host boundary and added to Realmroot issue #138; final cleanroom uses a fresh isolated API configuration, while no Resource-Server-specific rule is added to the plugin or Realmroot Skill |
| AFM-042 | OAuth/OIDC discovery | ZPan exposed only path-appended OpenID metadata, while Realmroot correctly requested the RFC discovery path for an issuer containing `/api/auth`; local Vite returned SPA HTML at that path. | ZPan serves both RFC OAuth and OpenID discovery paths at the application root, and the local frontend entry proxies `/.well-known` to the API. | Fixed in ZPan with OpenAPI/discovery tests; live Realmroot discovery passed |
| AFM-043 | Local dynamic registration | Dynamic registration rejected Realmroot's loopback HTTP `jwks_uri`, even though the complete local flow intentionally uses `localhost`. | HTTPS remains mandatory except for literal loopback hosts; both registration and later assertion verification apply the same exception. | Fixed in the Better Auth npm patch and ZPan registration management; focused registration tests passed |
| AFM-044 | Evolving authorization metadata | Realmroot retained an older provider metadata snapshot, and ZPan advertised its authorization-detail catalog extension only from OAuth metadata, not OpenID metadata. Workspace discovery therefore fell back to opaque identifiers instead of provider labels. | Agent connection requests refresh standard provider metadata; OAuth and OpenID discovery advertise the same catalog extension. | Fixed generically in Realmroot and ZPan; live discovery returned `Admin's Space` and `Agent Cleanroom 20260803` with roles and types |
| AFM-045 | Reverse-proxy URL binding | JWT assertion and DPoP validation compared public proofs bound to `localhost:5185` with the local proxy's rewritten backend URL `localhost:8222`. | Authentication validates canonical published endpoints, and the local proxy preserves the external Host for URL-bound proofs. | Fixed in ZPan OAuth verification and Vite proxy configuration; target credential issuance and secured file operations passed |
| AFM-046 | Object parent semantics | Generated `create-object`, `update-object`, and `list-objects` help exposed an unexplained `parent` string, so an Agent reasonably supplied a folder ID even though ZPan stores a slash-delimited folder path. | OpenAPI explicitly defines parent/path as workspace-relative slash-delimited folder paths and explains root handling; `hasChildren` explicitly means child folders. | Fixed in shared schemas and object OpenAPI; the corrected path-based move/list round passed |
| AFM-047 | Restish credential templates | Realmroot and ZPan emitted an unsupported sibling-level credential `params` object in `x-cli-config`, causing fresh profile validation to reject otherwise valid server templates. | Provider selection lives only in the supported `auth.params` contract. | Fixed in both server-owned OpenAPI templates and assertions |

## Regression rounds

### Round 0 — baseline

- Environment: local
- Workspaces: one (`Admin's Space`)
- Connection: completed manually from the returned URL
- Access approval: completed manually from the returned URL
- Token: workspace-bound DPoP token issued after correcting dynamic client metadata
- Operations: quota read, usage read, list objects, create draft, direct upload, complete upload, read object, download
- Integrity: downloaded SHA-256 matched the source file
- Result: file operations passed; approval orchestration, profiles, and error behavior failed acceptance

Future rounds must record the exact scenario, workspace count, connection state, grant state, file operations, boundary conditions, and outcome.

### Debug round 1 — plugin approval orchestration

- Rebuilt and reinstalled the local `restish-realmroot` binary from the working tree.
- Revoked the existing ZPan connection and grant through Realmroot's management API.
- `access connect` opened the controller page, waited, and returned `status: connected` from the original command.
- `access request` opened the controller page, waited across provider-scope expansion, and returned `status: approved` with a grant ID.
- The controller selected a persistent grant for repeated file-management regression.
- Target-token output initially exposed the token, so this round does not count as acceptance.
- Added fail-closed token-response handling. Real output-mode testing found that Restish's redirected raw-output fast path bypasses all response middleware.
- The skill now mandates `-o json`; the installed plugin stores the credential and suppresses the entire structured response, producing zero output bytes.

### Round 1 attempt — invalidated by concurrent environment

- CLI correctly discovered an existing connection, two authorized workspaces, and no grants.
- A separate Restish process owned by another local ChatGPT app session started a request for `Agent Regression Space` during the round.
- The returned approval token and terminal request no longer described the same attempted scenario.
- Process inspection was required to diagnose the conflict, so the attempt does not count.

### Round 1 — isolated two-workspace file lifecycle

- Environment: local services with a dedicated Realmroot plugin state directory.
- Identity: registered and approved through the foreground CLI workflow.
- Connection: reused the controller's existing active ZPan account connection.
- Authorization: requested and approved one persistent grant for each of the two catalog-discovered workspaces.
- Workspace switching: issued one workspace token at a time and switched Admin → Regression → Admin.
- Operations in both workspaces: quota, list, create draft, direct upload, complete, get, download, rename/move, create/revoke share, and soft delete.
- Integrity: both downloaded files matched the source SHA-256.
- Isolation: each workspace list exposed only that workspace's objects; the second workspace never exposed the Admin fixture, and the return switch never exposed Regression fixtures.
- Cleanup: all Round 1 objects and shares were revoked/deleted.
- Result: passed. No database/source inspection or browser use occurred after the two human-controller approvals.

### Round 2 — conflict and cross-workspace object boundaries

- Created the same folder name independently in both workspaces.
- A duplicate with `onConflict: fail` in one workspace returned 409.
- Reading the other workspace's object ID returned 404 in both directions, avoiding both access and existence disclosure.
- Removed both fixtures through their respective workspace tokens.
- Result: passed using only CLI operations after the existing approvals.

### Round 3 — least-privilege scope enforcement

- Requested and approved a one-token Admin workspace grant containing only `objects:read`.
- Listing objects succeeded; object creation and quota inspection both returned 403.
- Reissued the existing full Admin workspace grant; quota and create/delete operations immediately succeeded again.
- Result: passed. Authentication method and workspace binding did not bypass scope checks.

### Round 4 — interrupted direct upload

- Created a file draft in the Regression workspace without uploading bytes.
- Re-presigned part 1 using the operation advertised by the upload workflow.
- Strictly aborted the upload session.
- Workspace usage was unchanged and the draft was absent from the object list.
- Result: passed.

### Round 5 — zero-byte file and return isolation

- Created, directly uploaded, completed, fetched, and downloaded a zero-byte text file in the Regression workspace.
- The downloaded file had length zero and the expected empty-file SHA-256.
- Switching to Admin hid both the name and object ID (404); switching back allowed deletion.
- Result: passed and cleaned up.

### Cleanroom Round 1 — existing connection and two persistent workspace grants

- Environment: local, isolated from other approval workflows.
- Discovery: generic Realmroot resource and authorization-context reads returned one connected ZPan account, two authorized workspaces, and one active exact-scope grant per workspace.
- Token safety: both workspace token commands used the skill-mandated structured formatter, exited successfully, and produced zero output bytes.
- Switching: after each token selection, `get-my-quota` returned the authorization-detail workspace identifier; no custom workspace header was used.
- Admin workspace: listed four existing files.
- Agent Regression workspace: listed its own files, read the uploaded object, obtained its download URL, and downloaded 8,590 bytes.
- Isolation: the same filename-shaped test artifacts in the Admin workspace were not visible after switching to Agent Regression Space.
- Result: passed using only Realmroot skill-directed CLI operations; no source, database, logs, or browser investigation was needed.

### Cleanroom Round 2 — nested CRUD, sharing, deletion, and tenant isolation

- Environment: local; started in Agent Regression Space and ended in Admin's Space.
- Created a folder and a file draft inside it, uploaded `README.md` directly to the advertised storage URL, and completed the upload from the returned ETag.
- Renamed the file, read it, obtained a download URL, and verified the downloaded SHA-256 against the local source.
- Created a direct share and revoked it; the terminal share state was `revoked`.
- Soft-deleted the file and folder; a subsequent file read failed as expected.
- Switched to the Admin grant and confirmed the second workspace's folder ID was unavailable there.
- Result: passed entirely through CLI; nested file management, share lifecycle, deletion, and cross-workspace isolation behaved correctly.

### Cleanroom Round 3 — historical exact-match behavior

- Environment: local; Agent Regression Space.
- Requested only `objects:read`; the then-current exact-match implementation did not reuse an existing broader persistent grant and therefore opened controller approval.
- The CLI printed one controller URL and waited. Browser use was limited to the controller reviewing the fixed workspace, selecting the default one-token lifetime, and approving.
- The original CLI command resumed with `status: approved` and a grant ID.
- The first target-token issuance exited zero with no output, and object listing succeeded in the selected workspace.
- A create-folder attempt failed with `PERMISSION_DENIED`, proving ZPan enforced the token's scope independently of authentication method.
- A second target-token issuance failed with an actionable inactive/consumed-grant error.
- Result: the one-token and scope-enforcement mechanics passed, but the redundant approval was later classified as AFM-039 and removed. Current behavior reuses durable authority while still issuing only the requested `objects:read` scope.

### Cleanroom Round 4 — fresh Agent identity and full workspace authorization

- Environment: local with a new `AGENT=zpan-regression-round4` runtime and no Agent identity, grants, or target credentials.
- The first generic Realmroot resource read printed an Agent-login approval URL and waited. After controller approval, the same command resumed and discovered all configured resources.
- Realmroot correctly exposed the controller's existing ZPan account connection to the new Agent but exposed no grants belonging to the previous Agent identity.
- Requested the exact file-management scopes for Agent Regression Space. The CLI opened and waited for controller approval; the controller selected persistent lifetime.
- Issued the workspace token with zero output, asserted the quota `orgId`, created and directly uploaded `CONTRIBUTING.md`, completed the upload, downloaded it, verified SHA-256, and deleted it.
- The object and quota both reported the selected workspace identifier.
- Result: passed; a clean Agent runtime reached full workspace-scoped file management using only CLI plus controller approvals.

### Final Cleanroom Round 5 — independent Skill-only acceptance

- Environment: fresh isolated Restish config, freshly installed plugin build, fresh plugin state, and a context-isolated Agent instructed to use only the Realmroot Skill and CLI. The parent test harness supplied local contract URLs because the production contract TLS endpoint was unavailable; the Agent did not configure APIs, credentials, profiles, or scopes.
- Discovery selected ZPan and two workspaces only from server-owned Resource Server and Resource representations. The account connection was already `connected`, so no connection interaction occurred.
- Exactly three controller decisions occurred: Agent identity, persistent authority for Agent Regression Space, and persistent authority for Agent Cleanroom 20260803.
- Both workspaces passed quota read, folder creation, search, rename, soft delete, trash readback, permanent purge, and empty post-purge trash verification.
- Switching B → A → B → A produced new short-lived Resource-bound receipts without a workspace header. Each workspace returned zero matches for the other workspace's live fixture while continuing to expose its own.
- A request for exactly `objects:read objects:update` reused the broader persistent A authority without interaction and returned a receipt containing exactly those two scopes.
- Result: passed. The Agent used no source, database, logs, browser, raw token, grant, connection ID, authorization-detail payload, or manual Restish configuration; all fixtures were purged.

### Paid Round 1 — quota exhaustion, x402 settlement, upload continuation

- Environment: local ZPan, Realmroot, ZPan Cloud, an x402 sandbox payer, MinIO, and a public HTTPS tunnel for the local ZPan callback.
- Store readiness: one active 1 GiB capacity tier, an active verified Base Sepolia USDC receiver, and a listed `storage.capacity.purchase` resource bound to the instance's registered public origin.
- Quota boundary: creating a 20 MiB draft in the 10 MiB Agent Regression workspace returned `CAPACITY_REQUIRED`, the current quota/usage/request size, a stable request hash, and one selectable standard capacity offer.
- Purchase: called the advertised ZPan capacity operation without a signature, received an x402 v2 `PAYMENT-REQUIRED` object, and passed that object unmodified to the discovered payer resource.
- Payer: requested a delegated sandbox budget, limited it to the exact merchant origin and payout address through the controller page, then authorized the 10,000-atomic-USDC payment and returned `PAYMENT-SIGNATURE`.
- Settlement and fulfillment: retried the same purchase with the same request hash/idempotency key and signature; ZPan returned `status: delivered`. The payer subsequently verified the `PAYMENT-RESPONSE` and recorded the payment as settled.
- Upload continuation: retried the exact original create-object body, received a direct-upload workflow, uploaded 20 MiB to storage, completed the upload using the returned ETag, and fetched the object download URL.
- Integrity: source and downloaded SHA-256 were both `cd52d81e25f372e6fa4db2c0dfceb59862c1969cab17096da352b34950c973cc`.
- Isolation: the retried object and quota both reported `3aDEJGbtmnIhVTy1gFYsj3Zpyr81AZMh`; no workspace-selection header was used. The uploaded fixture was deleted after verification.
- Result: passed. After store readiness and controller budget approval, the counted Agent-side payment and file flow used only Realmroot/Restish and the discovered payer API; no source, database, logs, or browser diagnostics were needed.

### Staging Round 1 — account expansion and two-workspace file management

- Environment: production Realmroot identity plane, ZPan staging, ZPan Cloud staging, staging object storage, and an online x402 sandbox payer.
- Discovery: Realmroot listed both real ZPan workspaces, including labels, identifiers, types, roles, existing grant state, and `connectionAuthorized` state.
- Account expansion: the second workspace was discoverable but not yet connected. After fixing the connection revision wait, `access connect` stayed in the foreground while the controller updated the existing provider account and selected both workspaces; the selected item then reported `connectionAuthorized: true`.
- Authorization: approved one persistent exact-scope grant for each workspace. Target-token commands produced zero output and no custom workspace header was used.
- Profile boundary: the first target call exposed a missing staging security-scheme binding. After adding the required `oauth2`/`realmroot-target` binding and documenting it in the skill, target auth inspection and all intended operations became callable.
- Workspace switching: switched Preview Reviewer → Agent Staging Regression → Preview Reviewer → Agent Staging Regression by issuing one workspace token at a time.
- Operations: list, quota read, direct upload, upload completion, object read, download, rename, direct-share creation/revocation, and deletion.
- Integrity: the 4 KiB and 8 KiB files both downloaded with SHA-256 equal to their sources.
- Isolation: the new workspace initially listed zero objects; neither workspace could list the other workspace's test object after switching.
- Result: passed after the two discovered defects were fixed. The counted rerun used only Realmroot/Restish plus browser actions for controller consent.

### Staging Paid Round 1 — sandbox x402 and upload continuation

- Quota boundary: a 20 MiB draft in the 11 MiB Agent Staging Regression workspace returned `CAPACITY_REQUIRED` with the healthy staged 10 GiB plan and stable request hash.
- Purchase: the advertised operation returned x402 v2 for 1,000,000 atomic USDC on Base Sepolia. The online sandbox payer authorized it within the existing delegated budget.
- Settlement and fulfillment: ZPan returned `status: delivered`; the payer verified `PAYMENT-RESPONSE` and recorded transaction `0x16fa720d74baab46adaf8ca3cddeb4b857e7bb35c7b21b5b8fc29074a81d681f` as settled.
- Upload continuation: the unchanged original create body succeeded after delivery, 20 MiB uploaded directly, completion activated the object, and the download URL returned the same SHA-256 as the source.
- Result: passed entirely through public staging APIs and the sandbox payer. No staging database, source, logs, or non-approval browser investigation was used during the successful payment round.

### Staging revalidation — persistent switching and x402 recovery

- Started from a fresh production-Realmroot Agent identity and used only catalog discovery to find ZPan staging, its existing account connection, both authorized workspaces, and a sandbox payer resource.
- Verified that the default one-target-token lifetime is intentionally consumed after issuance. Re-approved both exact workspace grants as persistent, then switched Preview Reviewer → Agent Staging Regression → Preview Reviewer with no additional approval dialog and without a workspace header.
- Repeated file create, direct upload, completion, rename, download-integrity verification, and deletion through the staging profile.
- Deliberately exhausted the regression fixture's effective quota and received the published 10 GiB offer. The first orchestration attempt exposed AFM-025: the payer had signed the payment, while Cloud remained quoted because the caller had not forwarded the actual Restish response header.
- After correcting the response-header extraction, the same Cloud attempt became delivered, its order became paid and fulfilled, the payer recorded the Base Sepolia transaction as settled, and the unchanged original object request completed and downloaded with SHA-256 `155164370cf1dd288f29fb98401d4761528e7e23f02460a4695bde80bf16047a`.
- The fixture already had an active monthly period, so Cloud correctly scheduled the second purchase for the next period instead of stacking two current plans. The temporary staging entitlement mutation used to recreate exhaustion was restored after diagnosis.
- Result: passed. The product defect was in workflow guidance, not ZPan Cloud delivery; the successful rerun required no source or database lookup after the corrected header rule was applied.

### Production Round 1 — resource connection and two-workspace file management

- Environment: hosted Realmroot and production ZPan. Payment was intentionally excluded from production acceptance.
- Discovery: a fresh Agent discovered ZPan and four real workspaces through Realmroot's authorization-context catalog. The production Connector initially lacked the catalog endpoint and scope in its provider metadata; after the Connector was corrected, the existing account connection was updated once and all four selected workspaces reported `connectionAuthorized: true`.
- Connection orchestration: the first production reauthorization exposed a polling loop that tried to read the protected catalog before the provider connection revision changed. Realmroot now verifies connection completion from the resource-list connection revision and reads the protected catalog only after the update succeeds.
- Authorization: approved one persistent exact-scope grant for `Agent Regression 20260731` and one for `Production x402 Acceptance 20260802`.
- Workspace switching: issued one workspace token at a time and switched Regression → Production x402 Acceptance → Regression. Both grants remained active, the target command required no custom workspace header, and no second approval occurred.
- Regression workspace operations: quota read, direct upload of `README.md`, upload completion, download and SHA-256 verification, rename, landing-share creation/revocation, deletion, and empty post-delete search.
- Production x402 Acceptance workspace operations: quota read, isolation search, direct upload, completion, download and SHA-256 verification, and deletion.
- Integrity: both downloaded files matched source SHA-256 `155164370cf1dd288f29fb98401d4761528e7e23f02460a4695bde80bf16047a`.
- Isolation: the second workspace could not see the first workspace's named fixture, and every quota/object response reported the workspace selected by the current token.
- Result: passed using only Realmroot/Restish and direct advertised storage URLs after controller approvals. No production database, source, logs, or non-approval browser investigation was used.

### Final independent cleanroom — Realmroot skill only

- Environment: local, fresh isolated Realmroot plugin state, fresh Agent identity, local ZPan/ZPan Cloud, and a discovered x402 sandbox payer. The independent Agent received only the Realmroot skill and public endpoint locations; it did not inspect source, databases, logs, server processes, prior test artifacts, or browser state.
- Identity and connection: enrolled `ZPan Cleanroom Agent 20260803`, discovered ZPan and an x402 payer from Realmroot, connected the controller's ZPan account, and selected `Admin's Space` plus `Agent Cleanroom 20260803`.
- Authorization: obtained one persistent exact-scope grant per workspace and switched Admin → Cleanroom → Admin with one target token active at a time and no workspace header.
- Admin lifecycle: uploaded 4 KiB of real bytes, completed, downloaded with matching SHA-256, renamed, created/revoked a share, deleted, and verified absence.
- Payment: the cleanroom create returned `CAPACITY_REQUIRED`; the Agent followed the advertised purchase operation, received an x402 v2 Base Sepolia challenge for 10,000 atomic USDC, obtained a controller-constrained payer budget, forwarded `Payment-Signature`, forwarded `Payment-Response`, and confirmed payment `2efdb070-7116-471b-94fc-d2ea8cfd17eb` settled in transaction `0x45092914c6495077387a1ab80b96a01a3c39f7c5078eed78d2b481697b7cf802`.
- Recovery findings: the run exposed AFM-026 and AFM-027 without diagnostic access. Parent-side maintainers fixed both products and repaired the incomplete AFM-028 fixture; the independent Agent then resumed through only the public workflow.
- Paid upload continuation: retried the unchanged 8 KiB create request, directly uploaded and completed object `uEDeGtJOA0q_JG6FWoHXR`, downloaded SHA-256 `8a022f9acf03ba5ab4c44f70f8c4d827bd2744bf3d76cb9296f61276c038d054`, renamed, created/revoked a share, deleted, and verified the cleanroom list empty.
- Final switching and isolation: both replacement grants remained active/persistent, the return switch required no approval, each workspace hid the other's markers and filenames, and all fixtures were cleaned up.
- Result: passed. After the owning-project fixes and fixture repair, the independent Agent completed the whole identity → connection → workspace authorization → switching → file management → 402 payment → upload continuation → download URL path using only Realmroot skill-directed CLI plus controller approvals.

### Production Round 1 — deployment migration and two-workspace file management

- Deployed ZPan production version `c1d8a209-22f1-402e-aa37-da916db37853` after the complete GitHub CI matrix passed; the production D1 database had no pending migrations and the public health endpoint returned healthy.
- Refreshed the existing ZPan resource contract through Realmroot's public management surface and updated the existing provider account for `workspaces:discover` plus the file-management scopes. The controller selected all four real production workspaces.
- Realmroot's authorization-context catalog then returned four exact workspaces with labels, roles, types, identifiers, and `connectionAuthorized: true`; no ZPan database or source inspection was used.
- Approved one-target-token grants for `Ambor's Space` and `Team Test`. Each issuance exited zero with zero output bytes, and quota responses reported the exact selected workspace ID without a workspace header.
- In the first workspace, created and directly uploaded 4 KiB, completed the upload, downloaded and verified SHA-256, renamed the object, created and revoked a direct share, and later deleted the object.
- In the second workspace, the first workspace's object was absent. Created and directly uploaded 8 KiB, completed and downloaded it, verified source/download SHA-256 `ba887797188e2175f67c8365231898dfc8497d865cd525dca72727654e6a7df7`, and deleted it.
- Switched back to the first workspace with a fresh least-privilege one-target-token grant. The first object was present, the second object was absent, and deletion made the first object return 404.
- Result: passed. Production payment was intentionally not invoked; every fixture and share was cleaned up.

### Independent Cleanroom Round — skill-only local acceptance

- A context-isolated Agent received only the Realmroot skill and the acceptance objective. It was not given resource, connection, workspace, grant, or object identifiers and did not inspect source, databases, logs, service internals, or a browser.
- The Agent enrolled a fresh identity, kept default Restish profiles on production, selected the named `local` profiles, discovered the local ZPan resource and account connection, and discovered the live workspace catalog itself.
- Controller actions were performed outside the Agent context. The Agent requested only object CRUD, share read/create/delete, and quota read; it never used a custom workspace header.
- `Admin's Space`: uploaded 4,096 bytes, completed the direct upload, downloaded it, matched SHA-256 `a2f7d1fd6eb4269a2d9eeb998b75c490fe43489b50a7846d22432287e777d102`, renamed it, and created/revoked a share.
- A discovered Cleanroom workspace proved token binding and negative isolation but had zero quota. The Agent followed the documented connection-update workflow to authorize `Agent Regression Space` instead of inspecting internal state or forcing a payment outside this round's scope.
- `Agent Regression Space`: uploaded 8,192 bytes, completed and downloaded it, matched SHA-256 `23f4e37aa68b139804d4b6b0b829629c26c0aa84e6952eff7b33218184963fef`, renamed it, and created/revoked a share.
- Switching Admin → Cleanroom → Regression → Admin used only target-token issuance. Each token exposed only its workspace; direct reads of another workspace's object returned not-found.
- Both objects were deleted and confirmed absent, both shares were revoked, and the Agent removed its temporary files and isolated runtime directory.
- Result: passed. The independent Agent completed the requested two-workspace workflow using only the documented public command path plus external controller approvals.

### Independent Cleanroom Round 2 — non-interactive approval handoff

- A second context-isolated Agent started with a fresh identity and received only the Realmroot skill, the local public endpoints, and the acceptance objective. It did not inspect source, databases, logs, processes, or browser state.
- It exhausted generic resource discovery, selected ZPan, discovered three live workspace contexts, and selected the two provider-authorized workspaces without being given their identifiers.
- It requested the exact object CRUD, share read/create/delete, and quota-read scopes for each workspace. Both approval commands stayed in the foreground while a `0600` handoff file exposed one controller URL; neither request was interrupted or retried because of hidden output.
- Workspace `9Y3yalt9ZHXHoA3T4ksD1`: uploaded and completed 4 KiB, downloaded SHA-256 `a1ee703aed47acd75738bb837b1c3641ea8b9cc05df2b3e28fb4c5535a46dcc`, renamed, created/revoked a share, deleted, and verified absence.
- Workspace `ACleanroom20260803X01`: started empty, uploaded and completed 8 KiB, downloaded SHA-256 `ac8a2fe45d034f656a2c5a09d93f528d87ef7b66d9cc38ec5310ff88f839914e`, renamed, created/revoked a share, deleted, and verified absence.
- Switching used only workspace-token issuance and the named `local` target profile. Cross-workspace reads returned 404 and reciprocal searches returned zero; no custom workspace header was used.
- Cleanup removed both objects, revoked both shares, restored the local target profile, deleted the payload fixtures, and deleted the isolated Realmroot state directory. The two controller-approved persistent grants remain active for controller-side management.
- Result: passed. The corrected non-interactive approval handoff removed the only friction found by the first blind run, and the entire two-workspace file lifecycle completed through the documented public workflow.

## Residual observations

- `api auth inspect` summarizes all ungranted operations as a large scope union even when the exact requested operations are callable. This is informationally noisy but does not block exact-scope use.
- Create-share and delete-object responses are intentionally sparse; an Agent confirms terminal state through list/get readback.
- Persistent grant revocation is a controller-management responsibility and is not exposed as an Agent self-service operation.
- AFM-010 remains open in the workspace-creation UI. Workspace creation was explicitly outside this Agent file-management acceptance, and it did not block any counted round.
