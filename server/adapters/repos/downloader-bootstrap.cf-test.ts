import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { generateId } from '../../../shared/ids'
import { downloaderBootstrapCredential, session, user } from '../../db/auth-schema'
import { downloaders } from '../../db/schema'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import type { CreateDownloaderRecordInput } from '../../usecases/ports'
import { createDownloaderBootstrapCredentialRepo } from './downloader-bootstrap'

describe('[CF] downloader bootstrap credential repo', () => {
  it('atomically registers a downloader and consumes its bootstrap session in D1', async () => {
    const platform = createCloudflarePlatform(env)
    const db = platform.db
    const repo = createDownloaderBootstrapCredentialRepo(db, {
      hashDownloadToken: async (_platform, token) => `hash:${token}`,
    })
    const now = new Date('2026-08-05T00:00:00.000Z')
    const userId = generateId()
    const downloaderId = generateId()
    const bootstrapToken = `bootstrap-${generateId()}`

    await db.insert(user).values({
      id: userId,
      name: 'D1 Bootstrap User',
      email: `${userId}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await repo.issue({
      platform,
      token: bootstrapToken,
      userId,
      deviceCode: generateId(),
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await db.insert(session).values({
      id: generateId(),
      token: bootstrapToken,
      userId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    })

    await expect(
      repo.registerDownloader({
        platform,
        token: bootstrapToken,
        now,
        downloader: downloaderRecord(downloaderId, userId, now),
      }),
    ).resolves.toBe(true)
    await expect(db.select().from(downloaders).where(eq(downloaders.id, downloaderId))).resolves.toHaveLength(1)
    await expect(
      db.select().from(downloaderBootstrapCredential).where(eq(downloaderBootstrapCredential.userId, userId)),
    ).resolves.toMatchObject([{ consumedAt: now }])
    await expect(db.select().from(session).where(eq(session.token, bootstrapToken))).resolves.toHaveLength(0)

    const replayDownloaderId = generateId()
    await expect(
      repo.registerDownloader({
        platform,
        token: bootstrapToken,
        now,
        downloader: downloaderRecord(replayDownloaderId, userId, now),
      }),
    ).resolves.toBe(false)
    await expect(db.select().from(downloaders).where(eq(downloaders.id, replayDownloaderId))).resolves.toHaveLength(0)
  })
})

function downloaderRecord(id: string, createdBy: string, now: Date): CreateDownloaderRecordInput {
  return {
    id,
    name: 'D1 edge worker',
    tokenHash: `hash:${id}`,
    tokenJti: generateId(),
    version: '1.0.0',
    hostname: 'd1-edge',
    platform: 'linux',
    arch: 'amd64',
    engine: 'aria2',
    capabilities: ['http'],
    maxConcurrentTasks: 2,
    currentTasks: 0,
    downloadBps: 0,
    uploadBps: 0,
    freeDiskBytes: 1024,
    remoteDownloadCreditUnitBytes: 100 * 1024 * 1024,
    createdBy,
    now,
  }
}
