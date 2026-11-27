// The cache upload API for a scraped download's sidecars and upload layout
// (docs/design/torrent-cache.md §6). Sidecars go up first, then the layout that
// names them.

import { TORRENT_SIDECAR_MAX_BYTES, type TorrentFileUpload, type TorrentLayout } from '@shared/schemas'
import {
  TORRENT_LAYOUT_NAME,
  torrentExtraObjectKey,
  torrentLayoutObjectKey,
  torrentSidecarName,
} from '../../domain/torrent-cache'
import { badRequest, msg, notFound } from '../ports'
import { fillingTask, fillingTorrent, type TorrentFillDeps } from './fill'
import { layoutProblem, sidecarsOf } from './layout'

const UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60

async function fillStorage(deps: TorrentFillDeps, params: { taskId: string; downloaderId: string }) {
  const task = await fillingTask(deps, params)
  const torrent = await fillingTorrent(deps, task)
  const storage = await deps.storages.get(torrent.storageId)
  if (!storage) throw notFound('Torrent not found')
  return { torrent, storage }
}

export async function createTorrentSidecarUpload(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string; n: number; size: number },
): Promise<TorrentFileUpload> {
  const { torrent, storage } = await fillStorage(deps, params)
  const key = torrentExtraObjectKey(torrent.infoHash, torrentSidecarName(params.n))
  const url = await deps.s3.presignUpload(storage, key, undefined, UPLOAD_URL_TTL_SECONDS)
  return {
    uploadId: null,
    partSize: params.size,
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    parts: [{ partNumber: 1, url, offset: 0, length: params.size }],
  }
}

export async function completeTorrentSidecarUpload(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string; n: number },
  now = new Date(),
): Promise<{ n: number; size: number }> {
  const { torrent, storage } = await fillStorage(deps, params)
  const name = torrentSidecarName(params.n)
  const head = await deps.s3.headObject(storage, torrentExtraObjectKey(torrent.infoHash, name)).catch(() => null)
  if (!head) throw badRequest('Sidecar is not uploaded', 'TORRENT_SIDECAR_MISSING')
  if (head.size > TORRENT_SIDECAR_MAX_BYTES) throw badRequest('Sidecar is too large', 'TORRENT_SIDECAR_TOO_LARGE')
  await deps.torrents.saveExtraObject({
    torrentId: torrent.id,
    infoHash: torrent.infoHash,
    name,
    size: head.size,
    storageId: torrent.storageId,
    uploadedAt: now,
  })
  return { n: params.n, size: head.size }
}

// Stores the upload layout once its sidecars are up. Every torrent file it names
// must be in the torrent and every sidecar uploaded, so a transfer can always
// replay it.
export async function putTaskTorrentLayout(
  deps: TorrentFillDeps,
  params: { taskId: string; downloaderId: string; layout: TorrentLayout },
  now = new Date(),
): Promise<{ entries: number }> {
  const { torrent, storage } = await fillStorage(deps, params)
  const [files, extras] = await Promise.all([
    deps.torrents.listFiles(torrent.id),
    deps.torrents.listExtraObjects(torrent.id),
  ])
  const problem = layoutProblem(params.layout, files, sidecarsOf(extras))
  if (problem) throw badRequest(msg('Layout is invalid: {reason}', { reason: problem }), 'TORRENT_LAYOUT_INVALID')
  const bytes = new TextEncoder().encode(JSON.stringify(params.layout))
  await deps.s3.putObject(storage, torrentLayoutObjectKey(torrent.infoHash), bytes, 'application/json', bytes.length)
  await deps.torrents.saveExtraObject({
    torrentId: torrent.id,
    infoHash: torrent.infoHash,
    name: TORRENT_LAYOUT_NAME,
    size: bytes.length,
    storageId: torrent.storageId,
    uploadedAt: now,
  })
  return { entries: params.layout.entries.length }
}
