// A fill task uploads through the object API like any task (docs/design/torrents.md
// §2 decision 6, §4). The server decides where each upload is stored: under the
// task's upload token, a task filling a torrent stores every file at
// bt/<infoHash>/<torrent_files.id> and records it in torrent_files. A file
// created with `torrentPath` is that file of the torrent; any other file is a
// scraper sidecar. Folders the task creates and the `media` it writes are
// recorded the same way, each at its layout path relative to the task folder,
// so instant transfer can replay the layout for every later holder. The drive
// rows the object API writes reference those objects, so the requester holds
// exactly what it uploaded.

import { DirType } from '@shared/constants'
import type { MediaMetadata } from '@shared/schemas'
import { generateId } from '../../../shared/ids'
import { torrentFileMime } from '../../domain/torrent-info'
import { isTorrentKey, normalizeTorrentFolder, torrentEntryObjectKey } from '../../domain/torrents'
import type { Deps } from '../deps'
import {
  badRequest,
  type DownloadTaskRecord,
  type Matter,
  notFound,
  type StorageRecord,
  type TorrentRecord,
} from '../ports'
import { fillingTorrent, type TorrentFillDeps } from './fill'

export type FillUploadDeps = Pick<TorrentFillDeps, 'torrents' | 'downloadTasks' | 'storages'>

// Where a drive entry lies relative to the task folder, or null outside it.
export function taskLayoutPath(targetFolder: string, parent: string, name: string): string | null {
  const base = normalizeTorrentFolder(targetFolder)
  const folder = normalizeTorrentFolder(parent)
  let relative: string
  if (folder === base) relative = ''
  else if (!base) relative = folder
  else if (folder.startsWith(`${base}/`)) relative = folder.slice(base.length + 1)
  else return null
  return relative ? `${relative}/${name}` : name
}

// Where a file a fill task creates is stored.
export interface FillPlacement {
  torrent: TorrentRecord
  storage: StorageRecord
  kind: 'file' | 'sidecar'
  entryId: string
  objectKey: string
}

// The bt/ object a file created under the task's upload token is stored at, or
// null when the task fills no torrent (it then uploads an ordinary drive file).
// A `torrentPath` must name a file of the torrent at the size being uploaded.
export async function placeFillFile(
  deps: FillUploadDeps,
  task: DownloadTaskRecord,
  input: { torrentPath?: string; size: number },
): Promise<FillPlacement | null> {
  const torrent = await fillingTorrent(deps, task)
  if (!torrent) return null
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent not found')
  if (input.torrentPath === undefined) {
    const entryId = generateId()
    return { torrent, storage, kind: 'sidecar', entryId, objectKey: torrentEntryObjectKey(torrent.infoHash, entryId) }
  }
  const file = (await deps.torrents.listFiles(torrent.id)).find((item) => item.path === input.torrentPath)
  if (!file) throw badRequest('Torrent file not found', 'TORRENT_FILE_NOT_FOUND')
  if (file.size !== input.size) {
    throw badRequest('Uploaded file size does not match the torrent', 'TORRENT_FILE_SIZE_MISMATCH')
  }
  return { torrent, storage, kind: 'file', entryId: file.id, objectKey: file.objectKey }
}

// Records the layout path of a file the fill task created: a file of the
// torrent moves to where it was placed, and a sidecar gets its entry.
export async function recordFillFile(
  deps: FillUploadDeps,
  task: DownloadTaskRecord,
  placement: FillPlacement,
  matter: Matter,
): Promise<void> {
  const layoutPath = taskLayoutPath(task.targetFolder, matter.parent, matter.name) ?? matter.name
  if (placement.kind === 'file') {
    await deps.torrents.updateEntry(placement.entryId, { layoutPath, uploadedAt: null })
    return
  }
  await deps.torrents.insertEntry({
    id: placement.entryId,
    torrentId: placement.torrent.id,
    kind: 'sidecar',
    layoutPath,
    size: matter.size ?? 0,
    mime: torrentFileMime(matter.name),
    storageId: placement.storage.id,
    objectKey: placement.objectKey,
  })
}

// Records a folder the fill task placed files in.
export async function recordFillFolder(
  deps: FillUploadDeps,
  task: DownloadTaskRecord,
  matter: Pick<Matter, 'parent' | 'name'>,
  media: Record<string, unknown> | null = null,
): Promise<void> {
  const torrent = await fillingTorrent(deps, task)
  if (!torrent) return
  const layoutPath = taskLayoutPath(task.targetFolder, matter.parent, matter.name)
  if (!layoutPath) return
  const existing = await deps.torrents.findFolderEntry(torrent.id, layoutPath)
  if (existing) {
    if (media) await deps.torrents.updateEntry(existing.id, { media })
    return
  }
  await deps.torrents.insertEntry({
    id: generateId(),
    torrentId: torrent.id,
    kind: 'folder',
    layoutPath,
    size: 0,
    mime: '',
    storageId: torrent.storageId,
    objectKey: null,
    media,
  })
}

// An upload landed at a bt/ object: its entry is uploaded. A file of the torrent
// counts only at the size the info dictionary gives it, so check 2 catches a
// short upload; a sidecar takes the size that landed.
export async function markFillObjectUploaded(
  deps: Pick<Deps, 'torrents'>,
  params: { storageId: string; objectKey: string; size: number },
  now = new Date(),
): Promise<void> {
  if (!isTorrentKey(params.objectKey)) return
  const entry = await deps.torrents.findEntryByObject(params.storageId, params.objectKey)
  if (!entry) return
  if (entry.kind === 'file') {
    if (entry.size === params.size) await deps.torrents.updateEntry(entry.id, { uploadedAt: now })
    return
  }
  await deps.torrents.updateEntry(entry.id, { size: params.size, uploadedAt: now })
}

const MEDIA_IMAGE_FIELDS = ['poster', 'fanart', 'still'] as const

// The `media` a fill task wrote on one of its drive entries, recorded on the
// torrent's entry with each image named by its torrent_files id. An image that
// is not one of the torrent's sidecars (a poster kept from an earlier task) is
// left out, because later holders could not reach it.
export async function recordFillMedia(
  deps: FillUploadDeps & Pick<Deps, 'matter'>,
  task: DownloadTaskRecord,
  matter: Matter,
  media: MediaMetadata,
): Promise<void> {
  const torrent = await fillingTorrent(deps, task)
  if (!torrent) return
  const recorded: Record<string, unknown> = { ...media }
  for (const field of MEDIA_IMAGE_FIELDS) {
    const ref = recorded[field]
    if (typeof ref !== 'string') continue
    const image = await deps.matter.get(ref, matter.orgId)
    const entry =
      image && isTorrentKey(image.object) ? await deps.torrents.findEntryByObject(image.storageId, image.object) : null
    if (entry && entry.torrentId === torrent.id) recorded[field] = entry.id
    else delete recorded[field]
  }
  if (matter.dirtype !== DirType.FILE) {
    await recordFillFolder(deps, task, matter, recorded)
    return
  }
  if (!isTorrentKey(matter.object)) return
  const entry = await deps.torrents.findEntryByObject(matter.storageId, matter.object)
  if (entry && entry.torrentId === torrent.id) await deps.torrents.updateEntry(entry.id, { media: recorded })
}
