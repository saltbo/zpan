import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { createWebDavStateRepo } from './webdav-state'

function buildRepo() {
  return createWebDavStateRepo(createCloudflarePlatform(env).db)
}

describe('[CF] WebDAV locks on D1', () => {
  it('matches depth-infinity lock scopes without D1 dynamic LIKE expressions', async () => {
    const repo = buildRepo()
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
})
