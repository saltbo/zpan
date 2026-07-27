import type { Deps } from './deps'

const RESOURCE_CHANGE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function purgeExpiredResourceChanges(deps: Pick<Deps, 'resourceChanges'>, now = new Date()): Promise<number> {
  return deps.resourceChanges.purgeBefore(new Date(now.getTime() - RESOURCE_CHANGE_RETENTION_MS))
}
