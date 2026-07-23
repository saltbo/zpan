import { env } from 'cloudflare:workers'
import { nanoid } from 'nanoid'
import { describe, it } from 'vitest'
import { DirType, ObjectStatus } from '../../../shared/constants'
import { organization } from '../../db/auth-schema'
import { storages } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { expectStorageUsageConsistent } from '../../test/storage-usage-consistency'
import { createMatterRepo } from './matter'
import { initialStorageUsageProjectionQueries } from './storage-usage-breakdown'

describe('[CF] storage usage projection invariant', () => {
  it('matches raw D1 data after every file lifecycle mutation', async () => {
    const db = createCloudflarePlatform(env).db
    const orgId = `usage-${nanoid(8)}`
    const storageId = `storage-${nanoid(8)}`
    const now = new Date()
    await db.insert(organization).values({
      id: orgId,
      name: 'Storage Usage Test',
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
      customHost: '',
      capacity: 0,
      used: 0,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
    await executeWriteTransaction(db, initialStorageUsageProjectionQueries(db, orgId, now))

    const matter = createMatterRepo(db)
    await expectStorageUsageConsistent(db, orgId, 'D1 initial projection')

    const file = await matter.create({
      orgId,
      name: 'cloudflare.pdf',
      type: 'application/pdf',
      size: 1024,
      dirtype: DirType.FILE,
      parent: '',
      object: 'cloudflare.pdf',
      storageId,
      status: ObjectStatus.ACTIVE,
    })
    await expectStorageUsageConsistent(db, orgId, 'D1 create')

    await matter.applyUpload(orgId, file.id, {
      type: 'video/mp4',
      size: 2048,
      object: 'cloudflare.mp4',
    })
    await expectStorageUsageConsistent(db, orgId, 'D1 resize and MIME change')

    await matter.trash(orgId, file.id)
    await expectStorageUsageConsistent(db, orgId, 'D1 trash')

    await matter.restore(orgId, file.id)
    await expectStorageUsageConsistent(db, orgId, 'D1 restore')

    await matter.trash(orgId, file.id)
    await matter.purge(orgId, [file.id])
    await expectStorageUsageConsistent(db, orgId, 'D1 purge')
  })
})
