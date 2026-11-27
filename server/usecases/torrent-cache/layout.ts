// Sidecars and the upload layout of a cache download (docs/design/torrent-cache.md
// §3, §6). When scraping produced an upload plan, the downloader stores each
// sidecar the scraper wrote as bt/<infoHash>/x/<n> and the plan itself as
// bt/<infoHash>/layout.json, so every instant transfer replays the same layout.

import { type TorrentLayout, type TorrentLayoutEntry, torrentLayoutSchema } from '@shared/schemas'
import { TORRENT_LAYOUT_NAME } from '../../domain/torrent-cache'
import type { Deps } from '../deps'
import type { TorrentExtraObjectRecord, TorrentFileRecord, TorrentRecord } from '../ports'

// Removes what an earlier download of the torrent stored beside its files, so a
// download that takes it over starts from no sidecars and no layout.
export async function clearTorrentExtras(
  deps: Pick<Deps, 'torrents' | 'storages' | 's3'>,
  torrent: Pick<TorrentRecord, 'id' | 'storageId'>,
): Promise<void> {
  const extras = await deps.torrents.listExtraObjects(torrent.id)
  if (extras.length === 0) return
  const storage = await deps.storages.get(torrent.storageId)
  if (storage) {
    await deps.s3.evictTorrentCacheObjects(
      storage,
      extras.map((extra) => extra.objectKey),
    )
  }
  await deps.torrents.deleteExtraObjects(torrent.id)
}

// The uploaded sidecars by number.
export function sidecarsOf(extras: readonly TorrentExtraObjectRecord[]): Map<number, TorrentExtraObjectRecord> {
  const sidecars = new Map<number, TorrentExtraObjectRecord>()
  for (const extra of extras) {
    const match = /^x\/(\d+)$/.exec(extra.name)
    if (match) sidecars.set(Number(match[1]), extra)
  }
  return sidecars
}

// The torrent's layout, or null when it has none or what is stored cannot be
// replayed, in which case a transfer lays out the torrent's own tree.
export async function loadTorrentLayout(
  deps: Pick<Deps, 'torrents' | 'storages' | 's3'>,
  torrent: Pick<TorrentRecord, 'id' | 'storageId'>,
  files: readonly TorrentFileRecord[],
): Promise<{ layout: TorrentLayout; sidecars: Map<number, TorrentExtraObjectRecord> } | null> {
  const extras = await deps.torrents.listExtraObjects(torrent.id)
  const stored = extras.find((extra) => extra.name === TORRENT_LAYOUT_NAME)
  if (!stored) return null
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(await deps.s3.getObjectBytes(storage, stored.objectKey)))
  } catch {
    return null
  }
  const result = torrentLayoutSchema.safeParse(parsed)
  if (!result.success) return null
  const sidecars = sidecarsOf(extras)
  if (layoutProblem(result.data, files, sidecars)) return null
  return { layout: result.data, sidecars }
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function stem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

function imageRefs(entry: TorrentLayoutEntry): string[] {
  if (entry.kind === 'sidecar' || !entry.media) return []
  const media = entry.media as { poster?: string; fanart?: string; still?: string }
  return [media.poster, media.fanart, media.still].filter((ref): ref is string => ref !== undefined)
}

// Why a layout cannot be replayed onto the torrent, or null when it can.
export function layoutProblem(
  layout: TorrentLayout,
  files: readonly Pick<TorrentFileRecord, 'fileIdx'>[],
  sidecars: ReadonlyMap<number, unknown>,
): string | null {
  const fileIdxs = new Set(files.map((file) => file.fileIdx))
  const byPath = new Map<string, TorrentLayoutEntry>()
  const usedFiles = new Set<number>()
  const usedSidecars = new Set<number>()
  for (const entry of layout.entries) {
    const key = entry.path.toLowerCase()
    if (byPath.has(key)) return `${entry.path} appears twice`
    byPath.set(key, entry)
    if (entry.kind === 'torrent-file') {
      if (!fileIdxs.has(entry.fileIdx))
        return `${entry.path} names file ${entry.fileIdx}, which the torrent does not hold`
      if (usedFiles.has(entry.fileIdx)) return `file ${entry.fileIdx} appears twice`
      usedFiles.add(entry.fileIdx)
    }
    if (entry.kind === 'sidecar') {
      if (!sidecars.has(entry.sidecar)) return `${entry.path} names sidecar ${entry.sidecar}, which is not uploaded`
      if (usedSidecars.has(entry.sidecar)) return `sidecar ${entry.sidecar} appears twice`
      usedSidecars.add(entry.sidecar)
    }
  }
  for (const entry of layout.entries) {
    for (let parent = parentOf(entry.path); parent; parent = parentOf(parent)) {
      const holder = byPath.get(parent.toLowerCase())
      if (holder && holder.kind !== 'folder') return `${entry.path} is inside ${holder.path}, which is a file`
    }
    if (entry.kind === 'sidecar' && entry.video !== undefined) {
      const video = byPath.get(entry.video.toLowerCase())
      if (video?.kind !== 'torrent-file') return `${entry.path} names ${entry.video}, which is not a torrent file`
      if (!baseName(entry.path).startsWith(stem(baseName(video.path)))) {
        return `${entry.path} is not named after ${entry.video}`
      }
    }
    for (const ref of imageRefs(entry)) {
      if (byPath.get(ref.toLowerCase())?.kind !== 'sidecar')
        return `${entry.path} references ${ref}, which is not a sidecar`
    }
  }
  return null
}
