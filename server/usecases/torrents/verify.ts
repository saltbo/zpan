// The torrent_verify background job, check 3 of docs/design/torrents.md §7:
// the torrent's bytes are read back from the storage and every piece's SHA-1 is
// compared with the info dictionary. Files are concatenated in dictionary order,
// because pieces span file boundaries; padding files are read as zeros. R2
// torrents are verified in full, over piece ranges continued in follow-up
// messages; other storages verify a random sample of 32 pieces.

import type { TorrentVerifyJobRequest } from '@shared/schemas'
import { parseTorrentInfo, pieceHash, pieceRangeSegments, pieceSize, type TorrentInfo } from '../../domain/torrent-info'
import {
  isR2Storage,
  samplePieces,
  TORRENT_VERIFY_BATCH_BYTES,
  TORRENT_VERIFY_SAMPLE_PIECES,
  torrentInfoObjectKey,
} from '../../domain/torrents'
import type { Deps } from '../deps'
import type { BackgroundJobMessage, S3StorageCredentials, Sha1Hasher } from '../ports'
import { completeJoinedTasks, failJoinedTasks, type TorrentFillDeps } from './fill'
import { purgeStreamChunks } from './stream'

export type TorrentVerifyDeps = TorrentFillDeps & Pick<Deps, 'pieceHasher' | 'torrentStream'>

type VerifyMessage = BackgroundJobMessage<TorrentVerifyJobRequest>

const ZERO_CHUNK = new Uint8Array(64 * 1024)

// Hashes pieces [from, to) and returns the first one that does not match, or
// null when all match. `objectKeys` maps each file index to its object.
export async function verifyPieceRange(
  deps: Pick<Deps, 's3' | 'pieceHasher'>,
  storage: S3StorageCredentials,
  objectKeys: ReadonlyMap<number, string>,
  info: TorrentInfo,
  from: number,
  to: number,
): Promise<number | null> {
  let piece = from
  let hasher: Sha1Hasher = deps.pieceHasher.sha1()
  let remaining = pieceSize(info, piece)

  // Feeds bytes in order, closing each piece at its boundary. False stops early
  // on the first mismatch.
  const feed = async (chunk: Uint8Array): Promise<boolean> => {
    let rest = chunk
    while (rest.length > 0 && piece < to) {
      const take = Math.min(remaining, rest.length)
      await hasher.update(rest.subarray(0, take))
      rest = rest.subarray(take)
      remaining -= take
      if (remaining > 0) continue
      const digest = await hasher.digest()
      if (!sameBytes(digest, pieceHash(info, piece))) return false
      piece++
      if (piece < to) {
        hasher = deps.pieceHasher.sha1()
        remaining = pieceSize(info, piece)
      }
    }
    return true
  }

  for (const segment of pieceRangeSegments(info, from, to)) {
    if (segment.padding) {
      for (let left = segment.length; left > 0; left -= ZERO_CHUNK.length) {
        if (!(await feed(ZERO_CHUNK.subarray(0, Math.min(left, ZERO_CHUNK.length))))) return piece
      }
      continue
    }
    const range = `bytes=${segment.start}-${segment.start + segment.length - 1}`
    const key = objectKeys.get(segment.fileIdx)
    if (!key) return piece
    let stream: ReadableStream<Uint8Array>
    try {
      stream = await deps.s3.getObjectStream(storage, key, range)
    } catch {
      return piece
    }
    const reader = stream.getReader()
    let read = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = value.subarray(0, Math.max(0, segment.length - read))
        read += value.length
        if (!(await feed(chunk))) return piece
        if (read >= segment.length) break
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    // A short object cannot hold the piece.
    if (read < segment.length) return piece
  }
  return piece < to ? piece : null
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export async function processTorrentVerify(deps: TorrentVerifyDeps, message: VerifyMessage): Promise<void> {
  const { orgId, jobId, request } = message
  const torrent = await deps.torrents.get(request.torrentId)
  if (!torrent || torrent.status !== 'verifying') {
    await deps.backgroundJobs.update(orgId, jobId, {
      status: 'completed',
      resultMetadata: { skipped: true, status: torrent?.status ?? null },
      cancelable: false,
      finishedAt: new Date(),
    })
    return
  }
  if (!request.resume) await deps.backgroundJobs.update(orgId, jobId, { status: 'running', startedAt: new Date() })

  try {
    const storage = await deps.storages.get(torrent.storageId)
    if (!storage) throw new Error('Torrent storage not found')
    const info = parseTorrentInfo(await deps.s3.getObjectBytes(storage, torrentInfoObjectKey(torrent.infoHash)))
    const full = !request.sample && isR2Storage(storage)
    const files = await deps.torrents.listFiles(torrent.id)
    const objectKeys = new Map(files.map((file) => [file.fileIdx, file.objectKey]))

    let mismatch: number | null = null
    if (full) {
      const from = request.resume?.nextPiece ?? 0
      const batch = Math.max(1, Math.floor(TORRENT_VERIFY_BATCH_BYTES / info.pieceLength))
      const to = Math.min(info.pieceCount, from + batch)
      mismatch = await verifyPieceRange(deps, storage, objectKeys, info, from, to)
      if (mismatch === null && to < info.pieceCount) {
        await deps.backgroundJobs.update(orgId, jobId, {
          progress: { fileCount: to, processedBytes: Math.min(to * info.pieceLength, info.totalLength) },
        })
        await deps.jobQueue.dispatch({ ...message, request: { ...request, resume: { nextPiece: to } } })
        return
      }
    } else {
      for (const piece of samplePieces(info.pieceCount, TORRENT_VERIFY_SAMPLE_PIECES)) {
        mismatch = await verifyPieceRange(deps, storage, objectKeys, info, piece, piece + 1)
        if (mismatch !== null) break
      }
    }

    const now = new Date()
    if (mismatch !== null) {
      await deps.torrents.transition(torrent.id, ['verifying'], 'invalid', { now })
      await failJoinedTasks(deps, torrent, now)
      await purgeStreamChunks(deps, torrent)
      console.error(
        `torrents.verify.invalid torrent=${torrent.id} piece=${mismatch} downloader=${torrent.sourceDownloaderId ?? ''}`,
      )
      await deps.backgroundJobs.update(orgId, jobId, {
        status: 'failed',
        errorMessage: `Piece ${mismatch} does not match the torrent`,
        resultMetadata: { status: 'invalid', piece: mismatch },
        retryable: false,
        cancelable: false,
        finishedAt: now,
      })
      return
    }
    const verified = full ? 'full' : 'sampled'
    await deps.torrents.transition(torrent.id, ['verifying'], 'ready', { verified, now })
    await completeJoinedTasks(deps, { ...torrent, status: 'ready', verified }, now)
    // Streams read the verified files from now on (docs/design/torrents.md §14).
    await purgeStreamChunks(deps, torrent)
    await deps.backgroundJobs.update(orgId, jobId, {
      status: 'completed',
      progress: { fileCount: info.pieceCount, processedBytes: info.totalLength },
      resultMetadata: { status: 'ready', verified, pieces: info.pieceCount },
      cancelable: false,
      finishedAt: now,
    })
  } catch (error) {
    await deps.backgroundJobs.update(orgId, jobId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
      cancelable: false,
      finishedAt: new Date(),
    })
  }
}
