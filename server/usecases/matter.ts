import type { ActivityRepo, ConflictStrategy, Matter, MatterRepo, QuotaRepo, StorageUsageRepo } from './ports'
import { StorageQuotaExceededError, withStorageUsageReservation } from './storage-usage'

// Quota-guarded draft→active confirmation. Composes the matter repo (conflict
// plan + draft activation) with the storage-usage reservation usecase, reaching
// the DB only through deps. Behavior preserved from the former matter service.
export type ConfirmUploadDeps = {
  matter: MatterRepo
  quota: QuotaRepo
  storageUsage: StorageUsageRepo
  activity: ActivityRepo
}

export interface ConfirmUploadOptions {
  onConflict?: ConflictStrategy
  userId?: string
  teamQuotaEnabled?: boolean
  /**
   * Overwrites the file being replaced: hard-purge it (delete row, S3 object,
   * shares). With it, a 'replace' frees the incumbent's quota so the upload is
   * charged as a net-size change — matching normal overwrite semantics. Without
   * it, replace falls back to trashing the incumbent.
   */
  purgeReplaced?: (incumbent: Matter) => Promise<void>
}

export async function confirmUpload(
  deps: ConfirmUploadDeps,
  id: string,
  orgId: string,
  opts: ConfirmUploadOptions = {},
): Promise<{ matter: Matter | null; quotaExceeded?: boolean }> {
  try {
    const existing = await deps.matter.get(id, orgId)
    if (!existing) return { matter: null }
    if (existing.status !== 'draft') return { matter: null }

    // Plan the overwrite now (side-effect-free). createMatter deferred it for
    // draft 'replace', so the incumbent is still active and the quota check
    // below accounts for its bytes being freed. The DB's partial unique index
    // fires on the status update as a final safety net against concurrent confirms.
    const plan = await deps.matter.planConflictResolution(
      orgId,
      existing.parent,
      existing.name,
      opts.onConflict ?? 'fail',
      { excludeId: existing.id, isFolder: false, userId: opts.userId },
    )

    const bytes = existing.size ?? 0
    // Purging the incumbent frees its bytes, so only the net size increase needs
    // headroom; a final reconcile then sets usage to the exact active+trashed sum.
    const overwrites = plan.toTrash != null && opts.purgeReplaced != null
    const reserveBytes = overwrites ? Math.max(0, bytes - (plan.toTrash?.size ?? 0)) : bytes

    return await withStorageUsageReservation(
      { quota: deps.quota, storageUsage: deps.storageUsage },
      { orgId, storageId: existing.storageId, bytes: reserveBytes, teamQuotaEnabled: opts.teamQuotaEnabled ?? true },
      async () => {
        // Quota reserved — now safe to execute the overwrite (if any).
        if (plan.toTrash && opts.purgeReplaced) {
          await opts.purgeReplaced(plan.toTrash)
          if (opts.userId) {
            await deps.activity.record({
              orgId,
              userId: opts.userId,
              action: 'replace',
              targetType: 'file',
              targetId: plan.toTrash.id,
              targetName: plan.toTrash.name,
            })
          }
        } else {
          await deps.matter.commitConflictPlan(orgId, plan, opts.userId)
        }

        const now = new Date()
        const activated = await deps.matter.activateDraft(id, orgId, plan.finalName, now)
        if (!activated) {
          throw new Error('CONFIRM_UPLOAD_RACE')
        }

        // The purge reconciled usage before this row became active; recompute
        // once more so the new file's bytes are reflected.
        if (overwrites) await deps.storageUsage.reconcile(orgId, [existing.storageId])

        const confirmed = { ...existing, name: plan.finalName, status: 'active', updatedAt: now }

        if (opts.userId) {
          await deps.activity.record({
            orgId,
            userId: opts.userId,
            action: 'upload_confirm',
            targetType: 'file',
            targetId: confirmed.id,
            targetName: confirmed.name,
          })
        }

        return { matter: confirmed }
      },
    )
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) return { matter: null, quotaExceeded: true }
    if (error instanceof Error && error.message === 'CONFIRM_UPLOAD_RACE') return { matter: null }
    throw error
  }
}
