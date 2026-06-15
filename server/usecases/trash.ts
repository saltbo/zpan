// The trash resource usecase. Owns the business decisions behind the
// /api/trash routes. Today that is a single operation — emptying the trash —
// which orchestrates the matter repo (enumerate trashed roots, collect each
// subtree) with the shared purge operation and the activity log.
//
// The heavy lifting (S3 deletes, quota reconciliation, share cascade, row
// removal) lives in purge.ts; this file composes it per trashed root so the
// http handler only resolves auth context, calls emptyTrash, and serializes the
// count.

import { type PurgeDeps, purgeRecursively } from './object'
import type { ActivityRepo } from './ports'

export type EmptyTrashDeps = PurgeDeps & {
  activity: ActivityRepo
}

export type EmptyTrashOutcome = { ok: true; purged: number }

/**
 * Permanently purges every trashed subtree for an org, reclaiming quota. Walks
 * one trashed root at a time through the same purge path as the auto-purge cron.
 * Records a `trash_empty` activity only when something was actually purged, so
 * emptying an already-empty trash leaves no audit noise.
 */
export async function emptyTrash(
  deps: EmptyTrashDeps,
  params: { orgId: string; userId: string },
): Promise<EmptyTrashOutcome> {
  const { orgId, userId } = params
  const roots = await deps.matter.listTrashedRoots(orgId)
  let purgedCount = 0
  for (const root of roots) {
    const matters = await deps.matter.collectForPurge(orgId, root.id)
    if (!matters) continue
    purgedCount += await purgeRecursively(deps, orgId, matters)
  }
  if (purgedCount > 0) {
    await deps.activity.record({
      orgId,
      userId,
      action: 'trash_empty',
      targetType: 'file',
      targetName: `${purgedCount} items`,
      metadata: { count: purgedCount },
    })
  }
  return { ok: true, purged: purgedCount }
}
