import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { DirType, ObjectStatus } from '../../../shared/constants'
import { generateId } from '../../../shared/ids'
import { organization } from '../../db/auth-schema'
import { storages } from '../../db/schema'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { NameConflictError } from '../../usecases/ports'
import { createMatterRepo } from './matter'

async function seed() {
  const db = createCloudflarePlatform(env).db
  const orgId = generateId()
  const storageId = generateId()
  const now = new Date()
  await db.insert(organization).values({
    id: orgId,
    name: 'Name Race Test',
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
  return { db, orgId, storageId }
}

// On D1 the pre-check and the insert are separate round trips, so two tasks
// creating one new show folder both pass the check. The loser must get the
// NameConflictError the HTTP layer answers with 409.
describe('MatterRepo on D1 — same-name folder race', () => {
  it('gives one folder and one NameConflictError naming it', async () => {
    const { db, orgId, storageId } = await seed()
    const matter = createMatterRepo(db)
    const create = () =>
      matter.create({
        orgId,
        name: 'Fleabag (2016)',
        type: 'folder',
        dirtype: DirType.USER_FOLDER,
        parent: 'TV',
        object: '',
        storageId,
        status: ObjectStatus.ACTIVE,
        onConflict: 'fail',
      })

    const results = await Promise.allSettled([create(), create()])

    const created = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(created).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0].reason).toBeInstanceOf(NameConflictError)
    const winner = (created[0] as PromiseFulfilledResult<{ id: string }>).value
    expect((failed[0].reason as NameConflictError).conflictingId).toBe(winner.id)
  })
})
