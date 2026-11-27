import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { generateId } from '../../../shared/ids'
import { storages } from '../../db/schema'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { createTorrentRepo } from './torrents'

// A torrent with more files than one D1 statement can insert: Sintel holds 11.
const FILE_COUNT = 40

describe('torrent repo on D1', () => {
  it('creates a torrent whose file rows exceed one statement’s bound parameters', async () => {
    const db = createCloudflarePlatform(env).db
    const storageId = generateId()
    const now = new Date()
    await db.insert(storages).values({
      id: storageId,
      bucket: 'bucket',
      endpoint: 'https://s3.example.com',
      region: 'auto',
      accessKey: 'key',
      secretKey: 'secret',
      filePath: '',
      capacity: 0,
      used: 0,
      enabled: true,
      status: 'unknown',
      statusReason: null,
      statusCheckedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    const repo = createTorrentRepo(db)
    const files = Array.from({ length: FILE_COUNT }, (_, fileIdx) => ({
      fileIdx,
      path: `Show/E${fileIdx}.mkv`,
      size: 1000 + fileIdx,
      mime: 'video/x-matroska',
    }))
    const torrent = await repo.create({
      infoHash: 'a'.repeat(40),
      storageId,
      name: 'Show',
      private: false,
      status: 'downloading',
      files,
    })
    const stored = await repo.listFiles(torrent.id)
    expect(stored.map((file) => file.fileIdx)).toEqual(files.map((file) => file.fileIdx))
    expect(torrent.fileCount).toBe(FILE_COUNT)
  })
})
