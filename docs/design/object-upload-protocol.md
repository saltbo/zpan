# Object Upload Protocol

> Status: Implemented for v2.9 with provisional upload size/TTL defaults
> Product surface: `/api/objects`

ZPan object uploads are control-plane-only through the server. File bytes are
PUT directly by the client to short-lived presigned S3 URLs and never traverse
ZPan server bandwidth.

## Stable Operations

Automation clients should discover and call these OpenAPI operation IDs:

| Operation ID | Method and path | Purpose |
| --- | --- | --- |
| `createObject` | `POST /api/objects` | Create a folder, or create a file draft plus upload instructions. |
| `presignObjectUploadParts` | `POST /api/objects/{id}/uploads/{uploadSessionId}/parts` | Re-sign a bounded list of missing multipart part numbers. |
| `completeObjectUpload` | `POST /api/objects/{id}/uploads/{uploadSessionId}/completions` | Finalize a single or multipart upload with explicit part number + ETag records. |
| `abortObjectUpload` | `DELETE /api/objects/{id}/uploads/{uploadSessionId}` | Abort an active upload session and discard the draft. |

## Upload Instructions

`createObject` returns `upload` for file drafts:

- `sessionId`: stable ZPan upload session ID.
- `uploadId`: S3 multipart upload ID for multipart sessions, otherwise `null`.
- `mode`: `single` or `multipart`.
- `partSize`: bytes per part. Single uploads use the file size, including `0`
  for empty files.
- `partCount`: exact number of required part records for completion.
- `expiresAt`: ZPan upload session expiry.
- `presignedExpiresAt`: expiry for the returned presigned URLs.
- `requiredHeaders`: headers required by every returned part when applicable.
- `urls`: legacy positional presigned URL array retained for already-released
  clients. New automation should prefer `parts`.
- `parts`: explicit descriptors with `partNumber`, `url`, `expiresAt`, and
  `headers`.

Current provisional defaults are 64 MiB multipart parts and a 15 minute presign
TTL; both remain pending owner product confirmation. Presigned upload URLs are
short-lived. When a multipart URL expires, automation calls
`presignObjectUploadParts` with only the missing part numbers. Re-signing never
changes the workspace, object, session, storage key, or multipart upload
identity.

## Completion And Abort

`completeObjectUpload` accepts exactly the required `partCount` records. Each
record includes an explicit `partNumber` and the normalized S3 ETag returned by
that part PUT. Missing, duplicate, out-of-range, expired-session, or mismatched
single-PUT ETags are rejected before activation. Repeating completion after a
successful activation returns the active object. If S3 accepts multipart
completion but quota/conflict/database activation fails afterward, the upload
session records storage completion and a retry skips S3 completion while
retrying HEAD and draft activation.

`abortObjectUpload` is idempotent for already-aborted sessions. Multipart aborts
call S3 `AbortMultipartUpload`; single PUT aborts delete the storage object on a
best-effort basis unless `strictStorageCleanup=1` is supplied.

Every upload control-plane operation reauthorizes the caller's workspace and
object scope. Download-task upload tokens are also rechecked against their task,
downloader, and target folder before re-signing, completion, or abort.
