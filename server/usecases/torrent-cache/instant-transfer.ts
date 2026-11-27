// Instant transfer (闪传): gives a workspace a cached torrent by writing drive file
// rows whose objects are the cached keys, without copying any bytes
// (docs/design/torrent-cache.md §4). The workspace is charged quota for the full
// size; the storage's used bytes do not change, because no bytes landed.
//
// A torrent whose first download was scraped carries its upload layout
// (layout.json), which the transfer replays under the target folder the way the
// downloader uploads a plan (docs/design/media-library.md#upload-layout): folders
// are reused by name, a taken video name is renamed (`X (1).mkv`), a sidecar
// already at its name wins, and the `media` metadata is written once the
// sidecars exist, with each image path resolved to its matter id. A torrent
// without a layout is laid out as its own tree.

import { DirType, ObjectStatus } from '@shared/constants'
import { type MediaMetadata, mediaMetadataSchema, type TorrentLayout } from '@shared/schemas'
import { normalizeTorrentFolder, type TorrentStatus, torrentTreeRoot } from '../../domain/torrent-cache'
import { torrentFileMime } from '../../domain/torrent-info'
import type { Deps } from '../deps'
import {
  type ActorIdentity,
  type AppError,
  conflict,
  type Matter,
  notFound,
  quotaExceeded,
  StorageQuotaExceededError,
  type TorrentExtraObjectRecord,
  type TorrentFileRecord,
  type TorrentRecord,
} from '../ports'
import { withStorageUsageReservation } from '../storage-usage'
import { baseName, loadTorrentLayout, stem } from './layout'

export type InstantTransferDeps = Pick<Deps, 'torrents' | 'matter' | 'quota' | 'storageUsage' | 'storages' | 's3'>

export type InstantTransferOutcome = { ok: true; files: Matter[] } | { ok: false; error: AppError }

// What a transfer writes, with paths relative to the target folder.
interface PlannedFolder {
  path: string
  media?: Record<string, unknown>
}

interface PlannedFile {
  path: string
  size: number
  mime: string
  object: string
  // A sidecar: an entry already at its name wins, and it is not a file of the torrent.
  sidecar: boolean
  // The video a sidecar is named after.
  video?: string
  media?: Record<string, unknown>
}

interface TransferPlan {
  folders: PlannedFolder[]
  files: PlannedFile[]
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function treePlan(torrent: TorrentRecord, files: readonly TorrentFileRecord[]): TransferPlan {
  const root = torrentTreeRoot(torrent, files)
  return {
    folders: root ? [{ path: root }] : [],
    files: files.map((file) => ({
      path: root ? joinPath(root, file.path) : file.path,
      size: file.size,
      mime: file.mime,
      object: file.objectKey,
      sidecar: false,
    })),
  }
}

function layoutPlan(
  layout: TorrentLayout,
  files: readonly TorrentFileRecord[],
  sidecars: ReadonlyMap<number, TorrentExtraObjectRecord>,
): TransferPlan {
  const byIdx = new Map(files.map((file) => [file.fileIdx, file]))
  const plan: TransferPlan = { folders: [], files: [] }
  for (const entry of layout.entries) {
    if (entry.kind === 'folder') {
      plan.folders.push({ path: entry.path, media: entry.media })
      continue
    }
    if (entry.kind === 'torrent-file') {
      const file = byIdx.get(entry.fileIdx) as TorrentFileRecord
      plan.files.push({
        path: entry.path,
        size: file.size,
        mime: torrentFileMime(entry.path),
        object: file.objectKey,
        sidecar: false,
        media: entry.media,
      })
      continue
    }
    const sidecar = sidecars.get(entry.sidecar) as TorrentExtraObjectRecord
    plan.files.push({
      path: entry.path,
      size: sidecar.size,
      mime: torrentFileMime(entry.path),
      object: sidecar.objectKey,
      sidecar: true,
      video: entry.video,
    })
  }
  return plan
}

// The media with each image path replaced by the id of the matter now at it;
// an image that did not land is left out. Null when the result is not valid
// media.
function resolveMedia(media: Record<string, unknown>, ids: ReadonlyMap<string, string>): MediaMetadata | null {
  const resolved: Record<string, unknown> = { ...media }
  for (const field of ['poster', 'fanart', 'still']) {
    const ref = resolved[field]
    if (typeof ref !== 'string') continue
    const id = ids.get(ref.toLowerCase())
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
    // The download that filled the cache gets its files before verification
    // passes (docs/design/torrent-cache.md §7); every other transfer needs ready.
    sourceTaskId?: string
  },
): Promise<InstantTransferOutcome> {
  const { orgId } = params
  const torrent = await deps.torrents.get(params.torrentId)
  if (!torrent) return { ok: false, error: notFound('Torrent not found') }
  const notReady = conflict('Torrent is not ready', 'TORRENT_NOT_READY')
  const isSource = params.sourceTaskId !== undefined && params.sourceTaskId === torrent.sourceTaskId
  const statuses: TorrentStatus[] = isSource ? ['ready', 'verifying'] : ['ready']
  if (!statuses.includes(torrent.status)) return { ok: false, error: notReady }
  // Touching first makes a racing eviction lose: its claim requires the access
  // time it listed, and a claimed torrent is no longer ready to touch.
  if (!(await deps.torrents.touch(torrent.id, statuses, params.now ?? new Date())))
    return { ok: false, error: notReady }

  const files = await deps.torrents.listFiles(torrent.id)
  const stored = await loadTorrentLayout(deps, torrent, files)
  const plan = stored ? layoutPlan(stored.layout, files, stored.sidecars) : treePlan(torrent, files)
  const createdBy: ActorIdentity = { type: 'user', ref: params.userId, issuer: null }
  const totalBytes = plan.files.reduce((sum, file) => sum + file.size, 0)
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
        // Layout path (lowercase) → id of the matter now at it.
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
        for (const folder of plan.folders) await ensureFolder(full(folder.path))
        for (const file of plan.files) await ensureFolder(full(parentOf(file.path)))

        const matters: Matter[] = []
        const finalNames = new Map<string, string>()
        const createdFiles = new Set<string>()
        let unusedBytes = 0
        // Sidecars go last: they are named after the name their video was given.
        const ordered = [...plan.files.filter((file) => !file.sidecar), ...plan.files.filter((file) => file.sidecar)]
        for (const file of ordered) {
          const parent = await ensureFolder(full(parentOf(file.path)))
          const key = file.path.toLowerCase()
          let name = baseName(file.path)
          if (file.sidecar && file.video) {
            const videoName = finalNames.get(file.video.toLowerCase()) ?? baseName(file.video)
            name = stem(videoName) + name.slice(stem(baseName(file.video)).length)
          }
          if (file.sidecar) {
            const existing = await deps.matter.findActiveConflict(orgId, parent, name)
            if (existing && existing.dirtype === DirType.FILE) {
              ids.set(key, existing.id)
              unusedBytes += file.size
              continue
            }
          }
          const matter = await deps.matter.create({
            ...owner,
            name,
            type: file.mime,
            size: file.size,
            dirtype: DirType.FILE,
            parent,
            object: file.object,
            onConflict: 'rename',
          })
          createdIds.push(matter.id)
          createdFiles.add(key)
          ids.set(key, matter.id)
          finalNames.set(key, matter.name)
          if (!file.sidecar) matters.push(matter)
        }

        // Media goes on once the sidecars it references exist. A reused show
        // folder keeps the media an earlier transfer or upload gave it.
        for (const folder of plan.folders) {
          if (!folder.media) continue
          const media = resolveMedia(folder.media, ids)
          const target = folders.get(full(folder.path).toLowerCase())
          if (!media || !target) continue
          await deps.matter.setMediaMetadata(orgId, target.id, media, { onlyIfAbsent: !target.created })
        }
        for (const file of plan.files) {
          const key = file.path.toLowerCase()
          if (!file.media || !createdFiles.has(key)) continue
          const media = resolveMedia(file.media, ids)
          const id = ids.get(key)
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
