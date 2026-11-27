// The cached torrent a drive file references, for the file's details sheet
// (docs/design/torrent-cache.md §9).

import type { ObjectTorrent } from '@shared/schemas'
import { torrentInfoHashOfKey } from '../../domain/torrent-cache'
import type { Deps } from '../deps'
import { notFound } from '../ports'

// Not found when the file is absent, trashed, or not a cached file.
export async function getObjectTorrent(
  deps: Pick<Deps, 'matter' | 'torrents'>,
  params: { orgId: string; objectId: string },
): Promise<ObjectTorrent> {
  const matter = await deps.matter.get(params.objectId, params.orgId)
  const infoHash = matter && matter.trashedAt == null ? torrentInfoHashOfKey(matter.object) : null
  const torrent = infoHash ? await deps.torrents.getByInfoHash(infoHash) : null
  if (!matter || !torrent || torrent.storageId !== matter.storageId) throw notFound()
  return { infoHash: torrent.infoHash, name: torrent.name, status: torrent.status, verified: torrent.verified }
}
