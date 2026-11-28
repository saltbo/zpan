// Chunks and wants of torrents streamed while they download
// (docs/design/torrents.md §14).

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import { generateId } from '../../../shared/ids'
import { torrentStreamChunks, torrentStreamWants } from '../../db/schema'
import type { Database } from '../../platform/interface'
import type { TorrentStreamChunkRecord, TorrentStreamRepo } from '../../usecases/ports'

const chunkColumns = {
  torrentId: torrentStreamChunks.torrentId,
  firstPiece: torrentStreamChunks.firstPiece,
  pieceCount: torrentStreamChunks.pieceCount,
  objectKey: torrentStreamChunks.objectKey,
  size: torrentStreamChunks.size,
}

export function createTorrentStreamRepo(db: Database): TorrentStreamRepo {
  return {
    async listChunks(torrentId) {
      return db
        .select(chunkColumns)
        .from(torrentStreamChunks)
        .where(eq(torrentStreamChunks.torrentId, torrentId))
        .orderBy(asc(torrentStreamChunks.firstPiece))
    },

    async findChunk(torrentId, piece) {
      const rows = await db
        .select(chunkColumns)
        .from(torrentStreamChunks)
        .where(
          and(
            eq(torrentStreamChunks.torrentId, torrentId),
            lte(torrentStreamChunks.firstPiece, piece),
            sql`${torrentStreamChunks.firstPiece} + ${torrentStreamChunks.pieceCount} > ${piece}`,
          ),
        )
        .orderBy(asc(torrentStreamChunks.firstPiece))
        .limit(1)
      return rows[0] ?? null
    },

    async insertChunk(input) {
      await db
        .insert(torrentStreamChunks)
        .values({
          id: generateId(),
          torrentId: input.torrentId,
          firstPiece: input.firstPiece,
          pieceCount: input.pieceCount,
          objectKey: input.objectKey,
          size: input.size,
          createdAt: input.now,
        })
        .onConflictDoNothing()
    },

    async want(torrentId, piece, now) {
      await db
        .insert(torrentStreamWants)
        .values({ id: generateId(), torrentId, piece, wantedAt: now })
        .onConflictDoUpdate({
          target: [torrentStreamWants.torrentId, torrentStreamWants.piece],
          set: { wantedAt: now },
        })
    },

    async listWants(torrentId, since) {
      const rows = await db
        .select({ piece: torrentStreamWants.piece })
        .from(torrentStreamWants)
        .where(and(eq(torrentStreamWants.torrentId, torrentId), gte(torrentStreamWants.wantedAt, since)))
        .orderBy(asc(torrentStreamWants.piece))
      return rows.map((row) => row.piece)
    },

    async purge(torrentId) {
      const chunks: TorrentStreamChunkRecord[] = await db
        .select(chunkColumns)
        .from(torrentStreamChunks)
        .where(eq(torrentStreamChunks.torrentId, torrentId))
      await db.delete(torrentStreamChunks).where(eq(torrentStreamChunks.torrentId, torrentId))
      await db.delete(torrentStreamWants).where(eq(torrentStreamWants.torrentId, torrentId))
      return chunks
    },
  }
}
