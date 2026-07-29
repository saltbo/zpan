import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { downloaderBootstrapCredential, session, user } from '../../db/auth-schema'
import { downloaders } from '../../db/schema'
import { createTestApp } from '../../test/setup'
import type { CreateDownloaderRecordInput } from '../../usecases/ports'
import { createDownloaderBootstrapCredentialRepo } from './downloader-bootstrap'

const now = new Date('2026-07-29T00:00:00.000Z')

describe('downloader bootstrap credential repo', () => {
  it('resolves active, expired, and consumed bootstrap credentials', async () => {
    const { db, platform } = await createTestApp()
    await seedUser(db, 'user-1')
    const repo = createDownloaderBootstrapCredentialRepo(db, hashOnlyTokens())

    await repo.issue({
      platform,
      token: 'active-token',
      userId: 'user-1',
      deviceCode: 'device-active',
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await repo.issue({
      platform,
      token: 'expired-token',
      userId: 'user-1',
      deviceCode: 'device-expired',
      expiresAt: new Date(now.getTime() - 1),
    })

    await expect(repo.resolve(platform, 'missing-token', now)).resolves.toBeNull()
    await expect(repo.resolve(platform, 'active-token', now)).resolves.toEqual({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      active: true,
    })
    await expect(repo.resolve(platform, 'expired-token', now)).resolves.toEqual({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      active: false,
    })

    await db
      .update(downloaderBootstrapCredential)
      .set({ consumedAt: now })
      .where(eq(downloaderBootstrapCredential.tokenHash, 'hash:active-token'))
    await expect(repo.resolve(platform, 'active-token', now)).resolves.toMatchObject({ active: false })
  })

  it('consumes a bootstrap credential once', async () => {
    const { db, platform } = await createTestApp()
    await seedUser(db, 'user-1')
    const repo = createDownloaderBootstrapCredentialRepo(db, hashOnlyTokens())

    await repo.issue({
      platform,
      token: 'consume-token',
      userId: 'user-1',
      deviceCode: 'device-consume',
      expiresAt: new Date(now.getTime() + 60_000),
    })

    await expect(repo.consume(platform, 'consume-token', now)).resolves.toEqual({
      userId: 'user-1',
      clientId: 'zpan-cli',
      scope: 'downloader:register',
      active: false,
    })
    await expect(repo.consume(platform, 'consume-token', now)).resolves.toBeNull()
    await expect(repo.consume(platform, 'missing-token', now)).resolves.toBeNull()
  })

  it('atomically consumes bootstrap credentials while registering downloaders', async () => {
    const { db, platform } = await createTestApp()
    await seedUser(db, 'user-1')
    const repo = createDownloaderBootstrapCredentialRepo(db, hashOnlyTokens())

    await repo.issue({
      platform,
      token: 'register-token',
      userId: 'user-1',
      deviceCode: 'device-register',
      expiresAt: new Date(now.getTime() + 60_000),
    })
    await db.insert(session).values({
      id: 'session-1',
      token: 'register-token',
      userId: 'user-1',
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    })

    await expect(
      repo.registerDownloader({
        platform,
        token: 'register-token',
        now,
        downloader: downloaderRecord('downloader-1', 'user-1'),
      }),
    ).resolves.toBe(true)
    await expect(
      repo.registerDownloader({
        platform,
        token: 'register-token',
        now,
        downloader: downloaderRecord('downloader-2', 'user-1'),
      }),
    ).resolves.toBe(false)

    await expect(db.select().from(downloaders).where(eq(downloaders.id, 'downloader-1'))).resolves.toHaveLength(1)
    await expect(db.select().from(downloaders).where(eq(downloaders.id, 'downloader-2'))).resolves.toHaveLength(0)
    await expect(db.select().from(session).where(eq(session.token, 'register-token'))).resolves.toHaveLength(0)
  })
})

function hashOnlyTokens() {
  return {
    hashDownloadToken: async (_platform: unknown, token: string) => `hash:${token}`,
  }
}

async function seedUser(db: Awaited<ReturnType<typeof createTestApp>>['db'], id: string) {
  await db.insert(user).values({
    id,
    name: 'Bootstrap User',
    email: `${id}@example.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
}

function downloaderRecord(id: string, createdBy: string): CreateDownloaderRecordInput {
  return {
    id,
    name: 'Edge worker',
    tokenHash: `hash:${id}`,
    tokenJti: `jti:${id}`,
    version: '1.0.0',
    hostname: 'edge-1',
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
