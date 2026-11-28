// Purges the space of a deleted team. Better Auth removes the organization and
// the rows that reference it by foreign key; everything else the team owned is
// cleared here. Its files go through the same purge as emptying the trash, so
// their objects are released and the storage they used is freed. The purge is
// idempotent: the delete starts it in the background, and the daily trash sweep
// finishes any that was cut short.

import type { Deps } from './deps'
import { CANCELABLE_TASK_STATUSES, performDownloadTaskAction } from './downloads/downloads'
import { purgeRecursively } from './object'
import type { StoredObjectRef } from './ports'

const MATTER_BATCH = 200
const PENDING_ORG_BATCH = 20

const CANCELABLE: ReadonlySet<string> = new Set(CANCELABLE_TASK_STATUSES)

export async function purgeDeletedOrganization(
  deps: Deps,
  orgId: string,
  imageObjects: StoredObjectRef[] = [],
): Promise<void> {
  await stopDownloadTasks(deps, orgId)
  await cancelBackgroundJobs(deps, orgId)

  for (;;) {
    const batch = await deps.matter.listUnpurged(orgId, MATTER_BATCH)
    if (batch.length === 0) break
    await purgeRecursively(deps, orgId, batch)
  }

  await releaseImageObjects(deps, orgId, imageObjects)
  await deps.deletedOrganizations.deleteSpaceRows(orgId)
}

/** Finishes the purge of every deleted team whose space still holds rows. */
export async function purgeDeletedOrganizations(deps: Deps): Promise<number> {
  const orgIds = await deps.deletedOrganizations.listPendingPurge(PENDING_ORG_BATCH)
  let purged = 0
  for (const orgId of orgIds) {
    try {
      await purgeDeletedOrganization(deps, orgId)
      purged++
    } catch (error) {
      console.error(`org.purge.error org=${orgId} code=${errorCode(error)}`)
    }
  }
  return purged
}

// A running task is canceled first, so its downloader stops, and every task is
// then deleted, which asks its downloader to clean up what it holds locally.
async function stopDownloadTasks(deps: Deps, orgId: string): Promise<void> {
  const now = new Date()
  for (const task of await deps.deletedOrganizations.listLiveDownloadTasks(orgId)) {
    try {
      if (CANCELABLE.has(task.status)) {
        await performDownloadTaskAction(deps, orgId, task.id, 'cancel')
      }
      await deps.downloadTasks.delete(task.id, now)
    } catch (error) {
      console.error(`org.purge.task_error org=${orgId} task=${task.id} code=${errorCode(error)}`)
    }
  }
}

async function cancelBackgroundJobs(deps: Deps, orgId: string): Promise<void> {
  for (const id of await deps.deletedOrganizations.listActiveBackgroundJobIds(orgId)) {
    try {
      await deps.backgroundJobs.cancel(orgId, id)
    } catch (error) {
      console.error(`org.purge.job_error org=${orgId} job=${id} code=${errorCode(error)}`)
    }
  }
}

async function releaseImageObjects(deps: Deps, orgId: string, objects: StoredObjectRef[]): Promise<void> {
  const keysByStorage = new Map<string, string[]>()
  for (const { storageId, key } of objects) {
    keysByStorage.set(storageId, [...(keysByStorage.get(storageId) ?? []), key])
  }
  for (const [storageId, keys] of keysByStorage) {
    const storage = await deps.storages.get(storageId)
    if (storage) await deps.s3.deleteObjects(storage, keys)
  }
  if (keysByStorage.size > 0) await deps.storageUsage.reconcile(orgId, keysByStorage.keys())
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
