// Instant transfer (秒传): gives a workspace a torrent already on the instance
// by writing drive rows whose objects are the torrent's bt/ keys, without
// copying any bytes (docs/design/torrents.md §5). The workspace is charged
// quota for the full size; the storage's used bytes do not change, because no
// bytes landed.
//
// Every torrent_files row is written under the target folder at its
// layout_path, the way the downloader uploads a scraped plan
// (docs/design/media-library.md#upload-layout): folders are reused by name, a
// taken video name is renamed (`X (1).mkv`), a sidecar already at its name
// wins, and the `media` metadata is written once the sidecars exist, with each
// sidecar reference resolved to the id of the matter now at it.

import { DirType, ObjectStatus } from '@shared/constants'
import { type MediaMetadata, mediaMetadataSchema } from '@shared/schemas'
import { normalizeTorrentFolder, type TorrentStatus } from '../../domain/torrents'
import type { Deps } from '../deps'
import {
  type ActorIdentity,
  type AppError,
  conflict,
  type Matter,
  notFound,
  quotaExceeded,
  StorageQuotaExceededError,
  type TorrentEntryRecord,
} from '../ports'
import { withStorageUsageReservation } from '../storage-usage'

export type InstantTransferDeps = Pick<Deps, 'torrents' | 'matter' | 'quota' | 'storageUsage' | 'storages' | 's3'>

export type InstantTransferOutcome = { ok: true; files: Matter[] } | { ok: false; error: AppError }

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

// The media with each image's entry id replaced by the id of the matter now at
// it; an image that did not land is left out. Null when the result is not
// valid media.
function resolveMedia(media: Record<string, unknown>, ids: ReadonlyMap<string, string>): MediaMetadata | null {
  const resolved: Record<string, unknown> = { ...media }
  for (const field of ['poster', 'fanart', 'still']) {
    const ref = resolved[field]
    if (typeof ref !== 'string') continue
    const id = ids.get(ref)
    if (id) resolved[field] = id
    else delete resolved[field]
  }
  const parsed = mediaMetadataSchema.safeParse(resolved)
  return parsed.success ? parsed.data : null
}

export async function transferTorrent(
  deps: InstantTransferDeps,
  params: {
    torrentId: string
    orgId: string
    userId: string
    targetFolder: string
    now?: Date
    // The download task the transfer completes; its files record it.
    taskId?: string
  },
): Promise<InstantTransferOutcome> {
  const { orgId } = params
  const torrent = await deps.torrents.get(params.torrentId)
  if (!torrent) return { ok: false, error: notFound('Torrent not found') }
  const notReady = conflict('Torrent is not ready', 'TORRENT_NOT_READY')
  // Only a verified torrent reaches a workspace this way: the download that
  // filled it already holds the files it uploaded (docs/design/torrents.md §7).
  const statuses: TorrentStatus[] = ['ready']
  if (!statuses.includes(torrent.status)) return { ok: false, error: notReady }
  // Touching first makes a racing eviction lose: its claim requires the access
  // time it listed, and a claimed torrent is no longer ready to touch.
  if (!(await deps.torrents.touch(torrent.id, statuses, params.now ?? new Date())))
    return { ok: false, error: notReady }

  const entries = await deps.torrents.listEntries(torrent.id)
  const folderEntries = entries.filter((entry) => entry.kind === 'folder')
  // Files go before sidecars, so a sidecar never takes a video's name.
  const objectEntries = entries
    .filter(
      (entry): entry is TorrentEntryRecord & { objectKey: string } => entry.kind !== 'folder' && !!entry.objectKey,
    )
    .sort((a, b) => Number(a.kind === 'sidecar') - Number(b.kind === 'sidecar'))
  const createdBy: ActorIdentity = { type: 'user', ref: params.userId, issuer: null }
  const totalBytes = objectEntries.reduce((sum, entry) => sum + entry.size, 0)
  const base = normalizeTorrentFolder(params.targetFolder)
  const owner = {
    orgId,
    storageId: torrent.storageId,
    status: ObjectStatus.ACTIVE,
    createdByActorType: createdBy.type,
    createdByActorRef: createdBy.ref,
    createdByActorIssuer: createdBy.issuer,
    createdByTaskId: params.taskId ?? null,
  }

  try {
    const { matters, unusedBytes } = await withStorageUsageReservation(
      deps,
      { orgId, storageId: null, bytes: totalBytes },
      async (ctx) => {
        const createdIds: string[] = []
        ctx.onRollback(() => deps.matter.purge(orgId, createdIds))
        // Folder path from the workspace root (lowercase) → its drive path and id.
        const folders = new Map<string, { path: string; id: string; created: boolean }>()
        // Entry id → id of the matter now at it.
        const ids = new Map<string, string>()
        const full = (path: string) => (path ? joinPath(base, path) : base)

        // Resolves a folder path from the workspace root, reusing folders by name
        // and renaming past a file that holds the name.
        const ensureFolder = async (path: string): Promise<string> => {
          if (!path) return ''
          const key = path.toLowerCase()
          const known = folders.get(key)
          if (known) return known.path
          const parent = await ensureFolder(parentOf(path))
          const name = baseName(path)
          const existing = await deps.matter.findActiveConflict(orgId, parent, name)
          let folder: { path: string; id: string; created: boolean }
          if (existing && existing.dirtype !== DirType.FILE) {
            folder = { path: joinPath(parent, existing.name), id: existing.id, created: false }
          } else {
            const made = await deps.matter.create({
              ...owner,
              name,
              type: 'folder',
              size: 0,
              dirtype: DirType.USER_FOLDER,
              parent,
              object: '',
              onConflict: 'rename',
            })
            createdIds.push(made.id)
            folder = { path: joinPath(parent, made.name), id: made.id, created: true }
          }
          folders.set(key, folder)
          return folder.path
        }

        // Every folder is settled before any file is written.
        await ensureFolder(base)
        for (const folder of folderEntries) await ensureFolder(full(folder.layoutPath))
        for (const entry of objectEntries) await ensureFolder(full(parentOf(entry.layoutPath)))

        const matters: Matter[] = []
        const created = new Set<string>()
        let unusedBytes = 0
        for (const entry of objectEntries) {
          const parent = await ensureFolder(full(parentOf(entry.layoutPath)))
          const name = baseName(entry.layoutPath)
          if (entry.kind === 'sidecar') {
            const existing = await deps.matter.findActiveConflict(orgId, parent, name)
            if (existing && existing.dirtype === DirType.FILE) {
              ids.set(entry.id, existing.id)
              unusedBytes += entry.size
              continue
            }
          }
          const matter = await deps.matter.create({
            ...owner,
            name,
            type: entry.mime,
            size: entry.size,
            dirtype: DirType.FILE,
            parent,
            object: entry.objectKey,
            onConflict: 'rename',
          })
          createdIds.push(matter.id)
          created.add(entry.id)
          ids.set(entry.id, matter.id)
          if (entry.kind === 'file') matters.push(matter)
        }

        // Media goes on once the sidecars it references exist. A reused show
        // folder keeps the media an earlier transfer or upload gave it.
        for (const folder of folderEntries) {
          if (!folder.media) continue
          const media = resolveMedia(folder.media, ids)
          const target = folders.get(full(folder.layoutPath).toLowerCase())
          if (!media || !target) continue
          await deps.matter.setMediaMetadata(orgId, target.id, media, { onlyIfAbsent: !target.created })
        }
        for (const entry of objectEntries) {
          if (!entry.media || !created.has(entry.id)) continue
          const media = resolveMedia(entry.media, ids)
          const id = ids.get(entry.id)
          if (media && id) await deps.matter.setMediaMetadata(orgId, id, media, { onlyIfAbsent: false })
        }
        return { matters, unusedBytes }
      },
    )
    // A sidecar already in place was not written, so it is not charged.
    if (unusedBytes > 0) await deps.storageUsage.rollbackReservations([{ orgId, storageId: null, bytes: unusedBytes }])
    return { ok: true, files: matters }
  } catch (error) {
    if (error instanceof StorageQuotaExceededError) return { ok: false, error: quotaExceeded() }
    throw error
  }
}
