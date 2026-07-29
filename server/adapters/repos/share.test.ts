import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { DirType } from '../../../shared/constants'
import type { CreateShareInput } from '../../../shared/schemas/share'
import { matters } from '../../db/schema'
import type { Database } from '../../platform/interface'
import { createTestApp } from '../../test/setup.js'
import { createShareRepo } from './share.js'

async function seedMatter(db: Awaited<ReturnType<typeof createTestApp>>['db'], opts: { orgId: string }) {
  const now = new Date()
  const matter = {
    id: nanoid(),
    orgId: opts.orgId,
    alias: nanoid(10),
    name: `share-repo-${nanoid(6)}`,
    type: 'application/pdf',
    size: 0,
    dirtype: DirType.FILE,
    parent: '',
    object: `objects/${nanoid()}`,
    storageId: 'storage-1',
    status: 'active',
    trashedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(matters).values(matter)
  return matter
}

function createShare(db: Database, input: CreateShareInput) {
  return createShareRepo(db).create(input)
}

describe('createShareRepo API listing filters', () => {
  it('filters creator shares to the requested org', async () => {
    const { db } = await createTestApp()
    const creatorId = 'creator-list-filter'
    const orgA = `org-${nanoid()}`
    const orgB = `org-${nanoid()}`
    const matterA = await seedMatter(db, { orgId: orgA })
    const matterB = await seedMatter(db, { orgId: orgB })
    const shareA = await createShare(db, { matterId: matterA.id, orgId: orgA, creatorId, kind: 'landing' })
    const shareB = await createShare(db, { matterId: matterB.id, orgId: orgB, creatorId, kind: 'landing' })

    const filtered = await createShareRepo(db).listForApi(creatorId, { pageSize: 10, orgId: orgA })
    const unfiltered = await createShareRepo(db).listForApi(creatorId, { pageSize: 10 })

    expect(filtered.items.map((item) => item.id)).toEqual([shareA.id])
    expect(unfiltered.items.map((item) => item.id).sort()).toEqual([shareA.id, shareB.id].sort())
  })

  it('filters received shares to the requested org', async () => {
    const { db } = await createTestApp()
    const recipientId = 'recipient-list-filter'
    const orgA = `org-${nanoid()}`
    const orgB = `org-${nanoid()}`
    const matterA = await seedMatter(db, { orgId: orgA })
    const matterB = await seedMatter(db, { orgId: orgB })
    const shareA = await createShare(db, {
      matterId: matterA.id,
      orgId: orgA,
      creatorId: 'creator-a',
      kind: 'landing',
      recipients: [{ recipientUserId: recipientId }],
    })
    const shareB = await createShare(db, {
      matterId: matterB.id,
      orgId: orgB,
      creatorId: 'creator-b',
      kind: 'landing',
      recipients: [{ recipientUserId: recipientId }],
    })

    const filtered = await createShareRepo(db).listReceivedForApi(recipientId, null, { pageSize: 10, orgId: orgA })
    const unfiltered = await createShareRepo(db).listReceivedForApi(recipientId, null, { pageSize: 10 })

    expect(filtered.items.map((item) => item.id)).toEqual([shareA.id])
    expect(unfiltered.items.map((item) => item.id).sort()).toEqual([shareA.id, shareB.id].sort())
  })
})
