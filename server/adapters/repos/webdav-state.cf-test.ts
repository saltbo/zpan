import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { webdavLocks } from '../../db/schema'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { createWebDavStateRepo } from './webdav-state'

function buildRepo() {
  const db = createCloudflarePlatform(env).db
  return { db, repo: createWebDavStateRepo(db) }
}

describe('[CF] WebDAV locks on D1', () => {
  it('matches depth-infinity lock scopes without D1 dynamic LIKE expressions', async () => {
    const { repo } = buildRepo()
    const orgId = `org-${nanoid(8)}`
    const parent = await repo.createLock({
      orgId,
      resourcePath: 'Folder',
      owner: 'tester',
      depth: 'infinity',
      timeoutSeconds: 3600,
    })
    await repo.createLock({
      orgId,
      resourcePath: 'Other',
      owner: 'tester',
      depth: '0',
      timeoutSeconds: 3600,
    })

    expect((await repo.activeLocks(orgId, 'Folder/child.txt')).map((lock) => lock.id)).toEqual([parent.id])
    expect((await repo.conflictingLocks(orgId, 'Folder')).map((lock) => lock.id)).toEqual([parent.id])
    expect(await repo.refreshLock(orgId, 'Folder/child.txt', parent.token, 3600)).toMatchObject({ id: parent.id })
    expect(await repo.removeLock(orgId, 'Folder/child.txt', parent.token)).toBe(true)
    expect(await repo.activeLocks(orgId, 'Folder/child.txt')).toEqual([])
  })

  it('filters expired locks on reads and removes them during scheduled cleanup', async () => {
    const { db, repo } = buildRepo()
    const orgId = `org-${nanoid(8)}`
    const expired = await repo.createLock({
      orgId,
      resourcePath: 'expired.txt',
      owner: 'tester',
      depth: '0',
      timeoutSeconds: -1,
    })

    expect(await repo.activeLocks(orgId, 'expired.txt')).toEqual([])
    expect(await db.select().from(webdavLocks).where(eq(webdavLocks.id, expired.id))).toHaveLength(1)

    await repo.purgeExpiredLocks()

    expect(await db.select().from(webdavLocks).where(eq(webdavLocks.id, expired.id))).toHaveLength(0)
  })

  it('atomically rejects conflicting lock creation', async () => {
    const { repo } = buildRepo()
    const orgId = `org-${nanoid(8)}`
    const input = {
      orgId,
      resourcePath: 'Folder/file.txt',
      owner: 'tester',
      depth: '0',
      timeoutSeconds: 3600,
    }

    const attempts = await Promise.all([repo.tryCreateLock(input), repo.tryCreateLock(input)])

    expect(attempts.filter(Boolean)).toHaveLength(1)
    expect(await repo.activeLocks(orgId, input.resourcePath)).toHaveLength(1)
  })

  it('refreshes and removes a lock only when it applies to the request path', async () => {
    const { repo } = buildRepo()
    const orgId = `org-${nanoid(8)}`
    const lock = await repo.createLock({
      orgId,
      resourcePath: 'Folder',
      owner: 'tester',
      depth: '0',
      timeoutSeconds: 3600,
    })

    expect(await repo.refreshLock(orgId, 'Folder/child.txt', lock.token, 3600)).toBeNull()
    expect(await repo.removeLock(orgId, 'Folder/child.txt', lock.token)).toBe(false)
    expect(await repo.removeLock(orgId, 'Folder', lock.token)).toBe(true)
  })
})
