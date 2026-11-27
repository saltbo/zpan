// Instant transfer (闪传): gives a workspace a cached torrent by writing drive file
// rows whose objects are the cached keys, without copying any bytes
// (docs/design/torrent-cache.md §4). The workspace is charged quota for the full
// size; the storage's used bytes do not change, because no bytes landed.

import { DirType, ObjectStatus } from '@shared/constants'
import { normalizeTorrentFolder, torrentTreeRoot } from '../../domain/torrent-cache'
import type { Deps } from '../deps'
import {
  type ActorIdentity,
  type AppError,
  conflict,
  type Matter,
  notFound,
  quotaExceeded,
  StorageQuotaExceededError,
} from '../ports'
import { withStorageUsageReservation } from '../storage-usage'

export type InstantTransferDeps = Pick<Deps, 'torrents' | 'matter' | 'quota' | 'storageUsage'>

export type InstantTransferOutcome = { ok: true; files: Matter[] } | { ok: false; error: AppError }

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

export async function transferTorrent(
  deps: InstantTransferDeps,
  params: { torrentId: string; orgId: string; userId: string; targetFolder: string; now?: Date },
): Promise<InstantTransferOutcome> {
  const { orgId } = params
  const torrent = await deps.torrents.get(params.torrentId)
  if (!torrent) return { ok: false, error: notFound('Torrent not found') }
  const notReady = conflict('Torrent is not ready', 'TORRENT_NOT_READY')
  if (torrent.status !== 'ready') return { ok: false, error: notReady }
  // Touching first makes a racing eviction lose: its claim requires the access
  // time it listed, and a claimed torrent is no longer ready to touch.
  if (!(await deps.torrents.touchReady(torrent.id, params.now ?? new Date()))) return { ok: false, error: notReady }

  const files = await deps.torrents.listFiles(torrent.id)
  const createdBy: ActorIdentity = { type: 'user', ref: params.userId, issuer: null }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

  try {
    const created = await withStorageUsageReservation(
      deps,
      { orgId, storageId: null, bytes: totalBytes },
      async (ctx) => {
        const createdIds: string[] = []
        ctx.onRollback(() => deps.matter.purge(orgId, createdIds))
        const folders = new Map<string, string>()

        // Resolves a folder path below the target, reusing folders by name and
        // renaming past a file that holds the name.
        const ensureFolder = async (segments: string[]): Promise<string> => {
          let parent = ''
          for (const [index, name] of segments.entries()) {
            const key = segments.slice(0, index + 1).join('/')
            const known = folders.get(key)
            if (known !== undefined) {
              parent = known
              continue
            }
            const existing = await deps.matter.findActiveConflict(orgId, parent, name)
            let folderName: string
            if (existing && existing.dirtype !== DirType.FILE) {
              folderName = existing.name
            } else {
              const folder = await deps.matter.create({
                orgId,
                name,
                type: 'folder',
                size: 0,
                dirtype: DirType.USER_FOLDER,
                parent,
                object: '',
                storageId: torrent.storageId,
                status: ObjectStatus.ACTIVE,
                onConflict: 'rename',
                createdByActorType: createdBy.type,
                createdByActorRef: createdBy.ref,
                createdByActorIssuer: createdBy.issuer,
              })
              createdIds.push(folder.id)
              folderName = folder.name
            }
            parent = joinPath(parent, folderName)
            folders.set(key, parent)
          }
          return parent
        }

        const base = normalizeTorrentFolder(params.targetFolder).split('/').filter(Boolean)
        const root = torrentTreeRoot(torrent, files)
        const prefix = root ? [...base, root] : base
        const matters: Matter[] = []
        for (const file of files) {
          const segments = file.path.split('/').filter(Boolean)
          const name = segments.pop() ?? file.path
          const parent = await ensureFolder([...prefix, ...segments])
          const matter = await deps.matter.create({
            orgId,
            name,
            type: file.mime,
            size: file.size,
            dirtype: DirType.FILE,
            parent,
            object: file.objectKey,
            storageId: torrent.storageId,
            status: ObjectStatus.ACTIVE,
            onConflict: 'rename',
            createdByActorType: createdBy.type,
            createdByActorRef: createdBy.ref,
            createdByActorIssuer: createdBy.issuer,
          })
          createdIds.push(matter.id)
          matters.push(matter)
        }
        return matters
      },
    )
    return { ok: true, files: created }
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) return { ok: false, error: quotaExceeded() }
    throw error
  }
}
