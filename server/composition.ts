// The composition root. createDeps wires concrete adapters into the Deps object
// the rest of the server consumes. This is the ONLY place adapters are
// constructed. Keep it a cheap, request-free factory so the scheduled/queue
// entrypoints can reuse it; request-bound capabilities are passed to usecases as
// function parameters, never stored here.

import { createActivityRepo } from './adapters/repos/activity'
import { createStorageRepo } from './adapters/repos/storage'
import type { Platform } from './platform/interface'
import type { Deps } from './usecases/deps'

export function createDeps(platform: Platform): Deps {
  const { db } = platform
  return {
    activity: createActivityRepo(db),
    storages: createStorageRepo(db),
  }
}
