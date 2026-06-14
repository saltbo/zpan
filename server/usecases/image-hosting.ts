// The image-hosting (ihost) resource usecase. Owns every business decision behind
// the /api/ihost/images routes — the per-org "image hosting enabled" gate, the
// "a private storage must exist" requirement, draft-row creation + presign, the
// server-side upload finalize (reserve quota → draft → S3 → active, all rolling
// back together), the browser two-stage confirm, listing/lookup, and delete —
// so the http handlers only parse the request (multipart/base64, MIME sniffing,
// path validation), call these functions, and serialize the result.
//
// Expected business outcomes (feature-gated, no-storage, not-found, quota) come
// back as discriminated unions; the handler maps each to its HTTP status. The
// config gate returns the config row on success because the handler needs it to
// build the public image URL.

import type { AllowedImageMime } from '@shared/schemas'
import {
  type ImageHostingConfigRecord,
  type ImageHostingConfigRepo,
  type ImageHostingRecord,
  type ImageHostingRepo,
  type ListImageHostingsOptions,
  type QuotaRepo,
  type S3Gateway,
  StorageQuotaExceededError,
  type StorageRecord,
  type StorageRepo,
  type StorageUsageRepo,
} from './ports'
import { withStorageUsageReservation } from './storage-usage'

export type ImageHostingDeps = {
  imageHosting: ImageHostingRepo
  imageHostingConfigs: ImageHostingConfigRepo
  storages: StorageRepo
  storageUsage: StorageUsageRepo
  quota: QuotaRepo
  s3: S3Gateway
}

// The presign endpoint's TTL for the S3 upload URL. Mirrors PRESIGN_TTL_SECS in
// http/share-utils; kept local so the usecase owns no http import.
const PRESIGN_TTL_SECS = 5 * 60

// ── Config gate ──────────────────────────────────────────────────────────────
// Every ihost route first checks the org has image hosting enabled. The row is
// returned on success because the upload handler needs it to build the URL.

export type ImageHostingEnabledOutcome =
  | { ok: true; config: ImageHostingConfigRecord }
  | { ok: false; reason: 'not_enabled' }

export async function requireImageHostingEnabled(
  deps: Pick<ImageHostingDeps, 'imageHostingConfigs'>,
  orgId: string,
): Promise<ImageHostingEnabledOutcome> {
  const config = await deps.imageHostingConfigs.getByOrg(orgId)
  if (!config) return { ok: false, reason: 'not_enabled' }
  return { ok: true, config }
}

// ── Server-side upload finalize ──────────────────────────────────────────────

export interface FinalizeImageHostingUploadInput {
  orgId: string
  storage: StorageRecord
  path: string
  mime: AllowedImageMime
  bytes: Uint8Array
}

// Server-side upload finalize (multipart / base64 tools): reserve quota, create a
// draft row, stream the bytes to S3, then flip the row active. Quota + the row +
// the object all roll back together if any step throws.
export async function finalizeImageHostingUpload(
  deps: ImageHostingDeps,
  input: FinalizeImageHostingUploadInput,
): Promise<ImageHostingRecord> {
  return withStorageUsageReservation(
    deps,
    { orgId: input.orgId, storageId: input.storage.id, bytes: input.bytes.byteLength },
    async (ctx) => {
      const row = await deps.imageHosting.create({
        orgId: input.orgId,
        path: input.path,
        mime: input.mime,
        size: input.bytes.byteLength,
        storageId: input.storage.id,
        status: 'draft',
      })

      ctx.onRollback(async () => {
        await deps.imageHosting.delete(row.id, input.orgId)
        await deps.s3.deleteObject(input.storage, row.storageKey)
      })

      await deps.s3.putObject(input.storage, row.storageKey, input.bytes, input.mime)
      await deps.imageHosting.setActive(row.id, input.orgId)

      return row
    },
  )
}

// Select the org's private storage and finalize the upload. A missing private
// storage is an expected outcome (no storage configured → 503), surfaced as a
// discriminated union; quota overflow still throws StorageQuotaExceededError and
// is mapped by the handler via mapDomainError (→ 422).
export type UploadImageHostingOutcome = { ok: true; row: ImageHostingRecord } | { ok: false; reason: 'no_storage' }

export async function uploadImageHosting(
  deps: ImageHostingDeps,
  input: { orgId: string; path: string; mime: AllowedImageMime; bytes: Uint8Array },
): Promise<UploadImageHostingOutcome> {
  let storage: StorageRecord
  try {
    storage = await deps.storages.select('private')
  } catch {
    return { ok: false, reason: 'no_storage' }
  }

  const row = await finalizeImageHostingUpload(deps, {
    orgId: input.orgId,
    storage,
    path: input.path,
    mime: input.mime,
    bytes: input.bytes,
  })
  return { ok: true, row }
}

// ── Browser two-stage presign ────────────────────────────────────────────────
// Create a draft row and a presigned S3 upload URL; the client uploads to S3
// then PATCHes /:id to confirm. A missing private storage is an expected outcome.

export type PresignImageHostingResult = {
  id: string
  token: string
  path: string
  uploadUrl: string
  storageKey: string
}

export type PresignImageHostingOutcome =
  | { ok: true; result: PresignImageHostingResult }
  | { ok: false; reason: 'no_storage' }

export async function presignImageHostingUpload(
  deps: Pick<ImageHostingDeps, 'imageHosting' | 'storages' | 's3'>,
  input: { orgId: string; path: string; mime: AllowedImageMime; size: number },
): Promise<PresignImageHostingOutcome> {
  let storage: StorageRecord
  try {
    storage = await deps.storages.select('private')
  } catch {
    return { ok: false, reason: 'no_storage' }
  }

  const row = await deps.imageHosting.create({
    orgId: input.orgId,
    path: input.path,
    mime: input.mime,
    size: input.size,
    storageId: storage.id,
    status: 'draft',
  })

  const uploadUrl = await deps.s3.presignUpload(storage, row.storageKey, input.mime, PRESIGN_TTL_SECS)

  return {
    ok: true,
    result: { id: row.id, token: row.token, path: row.path, uploadUrl, storageKey: row.storageKey },
  }
}

// ── Confirm (browser two-stage) ──────────────────────────────────────────────

export type ConfirmImageHostingResult = { row: ImageHostingRecord | null; quotaExceeded?: boolean }

// Browser two-stage flow: confirm a draft after the client uploaded to the
// presigned URL. Reserves quota then flips the row active; a lost race or a
// missing/non-draft row yields { row: null }.
export async function confirmImageHosting(
  deps: ImageHostingDeps,
  id: string,
  orgId: string,
): Promise<ConfirmImageHostingResult> {
  const existing = await deps.imageHosting.get(id, orgId)
  if (!existing || existing.status !== 'draft') return { row: null }

  try {
    return await withStorageUsageReservation(
      deps,
      { orgId, storageId: existing.storageId, bytes: existing.size },
      async () => {
        const flipped = await deps.imageHosting.setActive(id, orgId)
        if (!flipped) return { row: null }
        return { row: { ...existing, status: 'active' as const } }
      },
    )
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) return { row: null, quotaExceeded: true }
    throw error
  }
}

// ── List / lookup ────────────────────────────────────────────────────────────

export function listImageHostings(
  deps: Pick<ImageHostingDeps, 'imageHosting'>,
  orgId: string,
  opts: ListImageHostingsOptions,
): Promise<{ items: ImageHostingRecord[]; nextCursor: string | null }> {
  return deps.imageHosting.list(orgId, opts)
}

export function getImageHosting(
  deps: Pick<ImageHostingDeps, 'imageHosting'>,
  id: string,
  orgId: string,
): Promise<ImageHostingRecord | null> {
  return deps.imageHosting.get(id, orgId)
}

// ── Delete ───────────────────────────────────────────────────────────────────

export type DeleteImageHostingDeps = { imageHosting: ImageHostingRepo; storageUsage: StorageUsageRepo; s3: S3Gateway }

// Delete a row and its S3 object (best-effort), then reconcile usage counters.
// Returns the deleted record, or null if it did not exist.
export async function deleteImageHosting(
  deps: DeleteImageHostingDeps,
  id: string,
  orgId: string,
  storage: StorageRecord | null,
): Promise<ImageHostingRecord | null> {
  const existing = await deps.imageHosting.get(id, orgId)
  if (!existing) return null

  if (storage) {
    try {
      await deps.s3.deleteObject(storage, existing.storageKey)
    } catch {
      // Best-effort S3 delete — proceed with DB cleanup regardless
    }
  }

  await deps.imageHosting.delete(existing.id, orgId)

  if (existing.status === 'active' && existing.size > 0) {
    await deps.storageUsage.reconcile(orgId, [existing.storageId])
  }

  return existing
}

// Resolve the storage row referenced by an image, then delete the image. Folds
// the handler's "load image → load its storage → delete" sequence into one call
// so the http layer makes no port access. Returns null when the image is absent.
export async function removeImageHosting(
  deps: Pick<ImageHostingDeps, 'imageHosting' | 'storages' | 'storageUsage' | 's3'>,
  id: string,
  orgId: string,
): Promise<ImageHostingRecord | null> {
  const existing = await deps.imageHosting.get(id, orgId)
  if (!existing) return null

  const storage = await deps.storages.get(existing.storageId)
  return deleteImageHosting(deps, existing.id, orgId, storage)
}
