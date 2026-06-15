// The storages resource usecase. Owns every business decision behind the
// /api/admin/storages routes — the Community storage-count limit, the
// egress-credit-billing feature gate, and activity logging — so the http
// handlers only validate input, call these functions, and serialize the result.
//
// Not to be confused with storage-usage.ts, which is the reusable
// quota-reservation operation consumed by the objects/matter flows. This file is
// the CRUD resource; that one is a cross-resource operation.

import { FREE_STORAGE_LIMIT } from '@shared/constants'
import type { CreateStorageInput, UpdateStorageInput } from '@shared/schemas'
import { hasFeature } from '../../domain/licensing'
import { loadBindingState } from '../licensing'
import type { ActivityRepo, LicenseBindingRepo, StorageRecord, StorageRepo } from '../ports'

export type StorageDeps = {
  storages: StorageRepo
  activity: ActivityRepo
  licenseBinding: LicenseBindingRepo
}

// The license feature that gates a storage write, plus the payload its 402
// carries. The http layer turns this into the `feature_not_available` body; the
// decision of *whether* a feature is required lives here.
export type StorageFeatureBlock =
  | { feature: 'storages_unlimited'; currentCount: number; limit: number }
  | { feature: 'quota_store' }

export type CreateStorageOutcome =
  | { ok: true; storage: StorageRecord }
  | { ok: false; reason: 'feature_blocked'; block: StorageFeatureBlock }

export type UpdateStorageOutcome =
  | { ok: true; storage: StorageRecord }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'feature_blocked'; block: StorageFeatureBlock }

export type DeleteStorageOutcome = { ok: true } | { ok: false; reason: 'not_found' | 'in_use' }

// Egress-credit billing is a paid capability; turning it on requires quota_store.
function enablesEgressCreditBilling(input: { egressCreditBillingEnabled?: boolean }): boolean {
  return input.egressCreditBillingEnabled === true
}

export function listStorages(deps: Pick<StorageDeps, 'storages'>): Promise<{ items: StorageRecord[]; total: number }> {
  return deps.storages.list()
}

export function getStorage(deps: Pick<StorageDeps, 'storages'>, id: string): Promise<StorageRecord | null> {
  return deps.storages.get(id)
}

export async function createStorage(
  deps: StorageDeps,
  params: { userId: string; orgId: string; input: CreateStorageInput },
): Promise<CreateStorageOutcome> {
  const { userId, orgId, input } = params
  const [total, state] = await Promise.all([
    deps.storages.count(),
    loadBindingState({ licenseBinding: deps.licenseBinding }),
  ])
  if (!hasFeature('storages_unlimited', state) && total >= FREE_STORAGE_LIMIT) {
    return {
      ok: false,
      reason: 'feature_blocked',
      block: { feature: 'storages_unlimited', currentCount: total, limit: FREE_STORAGE_LIMIT },
    }
  }
  if (enablesEgressCreditBilling(input) && !hasFeature('quota_store', state)) {
    return { ok: false, reason: 'feature_blocked', block: { feature: 'quota_store' } }
  }
  const storage = await deps.storages.create(input)
  await deps.activity.record({
    orgId,
    userId,
    action: 'storage_create',
    targetType: 'storage',
    targetId: storage.id,
    targetName: storage.title,
    metadata: { mode: storage.mode },
  })
  return { ok: true, storage }
}

export async function updateStorage(
  deps: StorageDeps,
  params: { userId: string; orgId: string; id: string; input: UpdateStorageInput },
): Promise<UpdateStorageOutcome> {
  const { userId, orgId, id, input } = params
  // Feature gate before the existence check — preserves 402-over-404 ordering.
  if (
    enablesEgressCreditBilling(input) &&
    !hasFeature('quota_store', await loadBindingState({ licenseBinding: deps.licenseBinding }))
  ) {
    return { ok: false, reason: 'feature_blocked', block: { feature: 'quota_store' } }
  }
  const storage = await deps.storages.update(id, input)
  if (!storage) return { ok: false, reason: 'not_found' }
  await deps.activity.record({
    orgId,
    userId,
    action: 'storage_update',
    targetType: 'storage',
    targetId: storage.id,
    targetName: storage.title,
    metadata: { mode: storage.mode },
  })
  return { ok: true, storage }
}

export async function deleteStorage(
  deps: StorageDeps,
  params: { userId: string; orgId: string; id: string },
): Promise<DeleteStorageOutcome> {
  const { userId, orgId, id } = params
  const existing = await deps.storages.get(id)
  const result = await deps.storages.delete(id)
  if (result === 'not_found') return { ok: false, reason: 'not_found' }
  if (result === 'in_use') return { ok: false, reason: 'in_use' }
  await deps.activity.record({
    orgId,
    userId,
    action: 'storage_delete',
    targetType: 'storage',
    targetId: id,
    targetName: existing?.title ?? id,
    metadata: { mode: existing?.mode },
  })
  return { ok: true }
}
