import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { DirType, ObjectStatus } from '../../../shared/constants'
import { generateId } from '../../../shared/ids'
import { organization } from '../../db/auth-schema'
import { storages } from '../../db/schema'
import { D1_MAX_BOUND_PARAMS, executeWriteTransaction } from '../../db/transaction'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { expectStorageUsageConsistent } from '../../test/storage-usage-consistency'
import { createMatterRepo } from './matter'
import { initialStorageUsageProjectionQueries } from './storage-usage-breakdown'

// More ids than D1 accepts as bound parameters in one statement (#619).
const ITEM_COUNT = D1_MAX_BOUND_PARAMS + 50

async function seed() {
  const db = createCloudflarePlatform(env).db
  const orgId = generateId()
  const storageId = generateId()
  const now = new Date()
  await db.insert(organization).values({
    id: orgId,
    name: 'Large Folder Test',
    slug: orgId,
    metadata: '{"type":"personal"}',
    createdAt: now,
    updatedAt: now,
  })
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
  await executeWriteTransaction(db, initialStorageUsageProjectionQueries(db, orgId, now))

  const matter = createMatterRepo(db)
  const folder = await matter.create({
    orgId,
    name: 'big',
    type: 'folder',
    size: 0,
    dirtype: DirType.USER_FOLDER,
    parent: '',
    object: '',
    storageId,
    status: ObjectStatus.ACTIVE,
  })
  const sub = await matter.create({
    orgId,
    name: 'sub',
    type: 'folder',
    size: 0,
    dirtype: DirType.USER_FOLDER,
    parent: 'big',
    object: '',
    storageId,
    status: ObjectStatus.ACTIVE,
  })
  const files = []
  for (let i = 0; i < ITEM_COUNT; i++) {
    files.push(
      await matter.create({
        orgId,
        name: `f${i}.txt`,
        type: 'text/plain',
        size: 10,
        dirtype: DirType.FILE,
        parent: i % 2 === 0 ? 'big' : 'big/sub',
        object: `f${i}.txt`,
        storageId,
        status: ObjectStatus.ACTIVE,
      }),
    )
  }
  return { db, orgId, matter, folder, ids: [folder.id, sub.id, ...files.map((f) => f.id)] }
}

describe('[CF] matter repo with more ids than D1 binds per statement', () => {
  it('trashes, restores and purges a large folder', async () => {
    const { db, orgId, matter, folder, ids } = await seed()

    await matter.trash(orgId, folder.id)
    const trashed = await matter.getMany(orgId, ids)
    expect(trashed).toHaveLength(ids.length)
    expect(trashed.every((m) => m.trashedAt != null)).toBe(true)
    await expectStorageUsageConsistent(db, orgId, 'D1 trash large folder')

    await matter.restore(orgId, folder.id)
    const restored = await matter.getMany(orgId, ids)
    expect(restored.every((m) => m.trashedAt == null)).toBe(true)
    await expectStorageUsageConsistent(db, orgId, 'D1 restore large folder')

    await matter.trashByIds(orgId, ids)
    expect((await matter.getMany(orgId, ids)).every((m) => m.trashedAt != null)).toBe(true)
    await matter.restoreActiveByIds(orgId, ids)
    expect((await matter.getMany(orgId, ids)).every((m) => m.trashedAt == null)).toBe(true)
    await expectStorageUsageConsistent(db, orgId, 'D1 trashByIds/restoreActiveByIds')

    await matter.trash(orgId, folder.id)
    await matter.purge(orgId, ids)
    expect(await matter.getMany(orgId, ids)).toHaveLength(0)
    await expectStorageUsageConsistent(db, orgId, 'D1 purge large folder')
  })
})
