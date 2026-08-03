# Agent File Management Regression Log

This document records end-to-end regressions for Agent-driven ZPan file management across Realmroot, Restish, ZPan, ZPan Cloud, and Agent Wallet. A round only passes when the Agent can discover state, connect accounts, request workspace-scoped access, switch workspaces, and manage files through the Realmroot skill and CLI.

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

### Round 1 — existing connection and two persistent workspace grants

- Environment: local, isolated from other approval workflows.
- Discovery: generic Realmroot resource and authorization-context reads returned one connected ZPan account, two authorized workspaces, and one active exact-scope grant per workspace.
- Token safety: both workspace token commands used the skill-mandated structured formatter, exited successfully, and produced zero output bytes.
- Switching: after each token selection, `get-my-quota` returned the authorization-detail workspace identifier; no custom workspace header was used.
- Admin workspace: listed four existing files.
- Agent Regression workspace: listed its own files, read the uploaded object, obtained its download URL, and downloaded 8,590 bytes.
- Isolation: the same filename-shaped test artifacts in the Admin workspace were not visible after switching to Agent Regression Space.
- Result: passed using only Realmroot skill-directed CLI operations; no source, database, logs, or browser investigation was needed.

### Round 2 — nested CRUD, sharing, deletion, and tenant isolation

- Environment: local; started in Agent Regression Space and ended in Admin's Space.
- Created a folder and a file draft inside it, uploaded `README.md` directly to the advertised storage URL, and completed the upload from the returned ETag.
- Renamed the file, read it, obtained a download URL, and verified the downloaded SHA-256 against the local source.
- Created a direct share and revoked it; the terminal share state was `revoked`.
- Soft-deleted the file and folder; a subsequent file read failed as expected.
- Switched to the Admin grant and confirmed the second workspace's folder ID was unavailable there.
- Result: passed entirely through CLI; nested file management, share lifecycle, deletion, and cross-workspace isolation behaved correctly.

### Round 3 — new least-privilege one-time grant

- Environment: local; Agent Regression Space.
- Requested a new exact grant for only `objects:read`; the existing broader persistent grant was not incorrectly reused.
- The CLI printed one controller URL and waited. Browser use was limited to the controller reviewing the fixed workspace, selecting the default one-token lifetime, and approving.
- The original CLI command resumed with `status: approved` and a grant ID.
- The first target-token issuance exited zero with no output, and object listing succeeded in the selected workspace.
- A create-folder attempt failed with `PERMISSION_DENIED`, proving ZPan enforced the token's scope independently of authentication method.
- A second target-token issuance failed with an actionable inactive/consumed-grant error.
- Result: passed; foreground approval, one-token lifetime, least privilege, and scope enforcement all behaved correctly without Agent-side diagnostics.

### Round 4 — fresh Agent identity and full workspace authorization

- Environment: local with a new `AGENT=zpan-regression-round4` runtime and no Agent identity, grants, or target credentials.
- The first generic Realmroot resource read printed an Agent-login approval URL and waited. After controller approval, the same command resumed and discovered all configured resources.
- Realmroot correctly exposed the controller's existing ZPan account connection to the new Agent but exposed no grants belonging to the previous Agent identity.
- Requested the exact file-management scopes for Agent Regression Space. The CLI opened and waited for controller approval; the controller selected persistent lifetime.
- Issued the workspace token with zero output, asserted the quota `orgId`, created and directly uploaded `CONTRIBUTING.md`, completed the upload, downloaded it, verified SHA-256, and deleted it.
- The object and quota both reported the selected workspace identifier.
- Result: passed; a clean Agent runtime reached full workspace-scoped file management using only CLI plus controller approvals.

### Paid Round 1 — quota exhaustion, x402 settlement, upload continuation

- Environment: local ZPan, Realmroot, ZPan Cloud, Agent Wallet Sandbox, MinIO, and a public HTTPS tunnel for the local ZPan callback.
- Store readiness: one active 1 GiB capacity tier, an active verified Base Sepolia USDC receiver, and a healthy listed `storage.capacity.purchase` resource.
- Quota boundary: creating a 20 MiB draft in the 10 MiB Admin workspace returned `CAPACITY_REQUIRED`, the current quota/usage/request size, a stable request hash, and one selectable standard capacity offer.
- Purchase: called the advertised ZPan capacity operation without a signature, received an x402 v2 `PAYMENT-REQUIRED` object, and passed that object unmodified to the local Agent Wallet resource.
- Wallet: the delegated budget authorized the 10,000-atomic-USDC payment without a new controller prompt and returned `PAYMENT-SIGNATURE`.
- Settlement and fulfillment: retried the same purchase with the same request hash/idempotency key and signature; ZPan returned `status: delivered`. Agent Wallet subsequently verified the `PAYMENT-RESPONSE` and recorded the payment as settled.
- Upload continuation: retried the exact original create-object body, received a direct-upload workflow, uploaded 20 MiB to storage, completed the upload using the returned ETag, and fetched the object download URL.
- Integrity: source and downloaded SHA-256 were both `cd52d81e25f372e6fa4db2c0dfceb59862c1969cab17096da352b34950c973cc`.
- Result: passed. After the store was configured, the Agent-side payment and file flow used only Realmroot/Restish and the local Agent Wallet API; no source, database, logs, or browser diagnostics were needed.
