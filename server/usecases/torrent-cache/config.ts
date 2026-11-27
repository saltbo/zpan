// The workspace torrent folder: where instant transfers land when no folder is
// given. Workspaces without a saved folder use `Media`.

import { DEFAULT_TORRENT_FOLDER, normalizeTorrentFolder } from '../../domain/torrent-cache'
import type { Deps } from '../deps'

export async function getTorrentFolder(deps: Pick<Deps, 'torrentCacheConfigs'>, orgId: string): Promise<string> {
  return (await deps.torrentCacheConfigs.getFolder(orgId)) ?? DEFAULT_TORRENT_FOLDER
}

export async function replaceTorrentFolder(
  deps: Pick<Deps, 'torrentCacheConfigs'>,
  orgId: string,
  folder: string,
): Promise<string> {
  const normalized = normalizeTorrentFolder(folder)
  await deps.torrentCacheConfigs.setFolder(orgId, normalized)
  return normalized
}
