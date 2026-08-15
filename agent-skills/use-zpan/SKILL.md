---
name: use-zpan
description: Use ZPan through Realmroot to browse private workspaces; list, inspect, upload, download, rename, move, copy, delete, restore, or purge files and folders; create or revoke shares; inspect quota and storage usage; and handle workspace-scoped access or upload-capacity workflows. Use whenever an Agent needs to read or operate a user's private ZPan storage with controller-approved least-privilege access.
---

# Use ZPan

Treat ZPan as private workspace-scoped file storage. Operate it through the
stable Agent identity and authority supplied by `$realmroot`. Do not borrow the
user's browser session, cookies, OAuth tokens, API keys, or WebDAV credentials.

## Discover The Live Contract

Require `$realmroot` to be installed. Reuse a known healthy ZPan Resource
Server, Context, operation, and authority. Discover or refresh only when the
target, Context, operation, or required scope is unknown, or after a connection,
authorization, or contract failure:

```bash
realmroot toolbox
realmroot toolbox zpan
realmroot toolbox zpan --search "<capability>"
realmroot toolbox zpan <group> <operation> --help
```

Select only the Resource Server named `zpan` unless the user explicitly asks
for another discovered deployment such as staging. Require its protected
resource URL to match the intended deployment. Treat Toolbox output and the
operation's live help as authoritative for operation names, arguments, scopes,
and response shapes; examples in this Skill are not a substitute for discovery.

## Select The Workspace Context

Inspect Contexts when no default is selected, multiple workspaces could match,
or the user names a workspace:

```bash
realmroot toolbox zpan context
realmroot toolbox zpan context show "<workspace>"
```

Use `--context "<workspace>"` for one workflow. Change the default with
`context use` only when the user asks to change it. A ZPan target credential is
bound to exactly one workspace; never add a custom workspace header or assume
that an object ID selects the correct workspace.

If the Context exists but is not connected or authorized, use `$realmroot` to
request the connection or authority and wait for controller approval. Do not
switch to the user's identity. When two workspaces are involved, finish and
verify operations in one Context before switching to the other.

## Request Least-Privilege Authority

Inspect every operation needed for the current workflow, then request their
scope union in one controller approval. Omit unrelated scopes. Typical mappings
are:

- list, inspect, and download objects or inspect trash: `objects:read`;
- create folders and upload or save objects: `objects:create`;
- rename, move, copy, restore, or transfer objects: `objects:update`;
- move objects to trash: `objects:delete`;
- permanently remove trashed objects: `objects:purge`;
- list, create, or revoke shares: `shares:read`, `shares:create`, or
  `shares:delete`;
- inspect quota or storage usage: `quota:read` or `storage-usage:read`.

Request all required scopes together and bind the request to the selected
Context:

```bash
realmroot agent request \
  --resource-server zpan \
  --scope <scope> \
  --context "<workspace>" \
  --reason "Manage the requested ZPan files"
```

Repeat `--scope` for each required scope. Existing broader durable authority
may satisfy a narrower request, but each issued target credential must contain
only the scopes needed now.

## Resolve Objects Before Acting

List or search within the selected Context and use IDs returned by ZPan:

```bash
realmroot toolbox zpan objects list-objects --parent "<path>" --json
realmroot toolbox zpan objects list-objects --search "<name>" --json
realmroot toolbox zpan objects get-object "<object-id>" --json
```

Follow `nextPageToken` until the desired object is found or results are
exhausted. Do not guess IDs, treat a same-named object in another Context as the
target, or use a stale ID from another deployment. If multiple objects match
and the user's intent does not distinguish them, present the material choices.

## Upload Files Directly

Inspect `create-object` help, determine the local file's exact byte size and
media type, and create a draft with `objects:create`. Preserve the exact create
body when retrying after an uncertain result or capacity purchase.

Use the returned `upload` descriptor as the authoritative workflow:

1. For every `upload.parts[]` entry, read exactly `offset` through
   `offset + length` from the local file.
2. Send that byte range directly to the part's presigned `url` with its exact
   method and `headers`. Do not route file bytes through Realmroot or ZPan.
3. Require a successful storage response and retain the response `ETag` with
   its `partNumber`.
4. Call the descriptor's `workflow.complete.operationId` with every
   `{partNumber, etag}` pair.
5. Read the completed object back and confirm its name, size, status, and
   selected workspace.

Use the advertised re-presign operation only for missing or expired part URLs.
Abort the advertised upload session when the workflow cannot be completed and
the user does not want the draft retained. Never log, display, or persist
presigned URLs; they are short-lived bearer capabilities.

For folders, create an object with the live folder representation advertised by
`create-object`; no storage upload follows. For a directory tree, create parent
folders before children and preserve relative paths.

## Download And Verify Files

Call `get-object` in the selected Context and use its current `downloadUrl`
immediately. Download directly from that presigned URL without sending it
through Realmroot. Do not persist or reveal the URL.

When the user asks to copy or verify a file, compare byte length and a local
cryptographic digest when practical. A successful HTTP status alone does not
prove that the intended bytes were received.

## Mutate, Share, And Remove Objects

Discover the relevant live operation first. After rename, move, copy, restore,
transfer, or share changes, read the object or share back when possible and
verify the requested state.

Treat `delete-object` as a soft delete into trash. Use permanent purge only
when the user explicitly requests irreversible removal, resolve the current
trash object first, and verify its absence afterward. Revoke shares before
cleanup when the workflow created them. Share tokens, passwords, direct URLs,
and recipient details are sensitive; return them only as needed for the user's
request.

## Handle Capacity And Failures

- On `402 CAPACITY_REQUIRED`, preserve the original create body and request
  hash. Follow only the purchase operation and offer advertised by the live
  response. Use `$realmroot` for any discovered payer and controller-approved
  budget, then retry the unchanged create request after confirmed delivery.
- On `401`, stop and use `$realmroot` to refresh the connection or target
  credential. Never retry with copied credentials.
- On `403`, re-read operation help and request only the missing task scope; also
  respect the workspace role reported by ZPan.
- On `404`, verify the deployment, Context, and current object ID. Do not assume
  that cross-workspace invisibility means deletion.
- On `409`, honor the user's conflict intent and use only a conflict strategy
  advertised by the live schema.
- On expired upload or download URLs, request fresh descriptors instead of
  reconstructing URLs.
- On an uncertain mutation result, read current state before retrying to avoid
  duplicate folders, drafts, copies, or shares.

Do not stop after discovery or approval. Complete the requested ZPan operation,
verify the resulting state, and report the selected workspace plus the relevant
object or share result without exposing credentials or presigned URLs.
