import type { AllowedImageMime } from '@shared/schemas'
import {
  type ImageHostingRecord,
  type ImageHostingRepo,
  type QuotaRepo,
  type S3Gateway,
  StorageQuotaExceededError,
  type StorageRecord,
  type StorageUsageRepo,
} from './ports'
import { withStorageUsageReservation } from './storage-usage'

export type ImageHostingDeps = {
  imageHosting: ImageHostingRepo
  storageUsage: StorageUsageRepo
  quota: QuotaRepo
  s3: S3Gateway
}

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
