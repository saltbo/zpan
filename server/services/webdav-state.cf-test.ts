import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createCloudflarePlatform } from '../platform/cloudflare'
import { activeLocks, conflictingLocks, createLock, refreshLock, removeLock } from './webdav-state'

function buildDb() {
  return createCloudflarePlatform(env).db
}

describe('[CF] WebDAV locks on D1', () => {
  it('matches depth-infinity lock scopes without D1 dynamic LIKE expressions', async () => {
    const db = buildDb()
    const orgId = `org-${nanoid(8)}`
    const parent = await createLock(db, {
      orgId,
      resourcePath: 'Folder',
      owner: 'tester',
      depth: 'infinity',
      timeoutSeconds: 3600,
    })
    await createLock(db, {
      orgId,
      resourcePath: 'Other',
      owner: 'tester',
      depth: '0',
      timeoutSeconds: 3600,
    })

    expect((await activeLocks(db, orgId, 'Folder/child.txt')).map((lock) => lock.id)).toEqual([parent.id])
    expect((await conflictingLocks(db, orgId, 'Folder')).map((lock) => lock.id)).toEqual([parent.id])
    expect(await refreshLock(db, orgId, 'Folder/child.txt', parent.token, 3600)).toMatchObject({ id: parent.id })
    expect(await removeLock(db, orgId, 'Folder/child.txt', parent.token)).toBe(true)
    expect(await activeLocks(db, orgId, 'Folder/child.txt')).toEqual([])
  })
})
