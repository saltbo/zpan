import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DirType, ObjectStatus } from '../../../shared/constants'
import { storageUsageBreakdowns } from '../../db/schema'
import { executeWriteTransaction } from '../../db/transaction'
import { authedHeaders, createTestApp } from '../../test/setup'
import { expectStorageUsageConsistent } from '../../test/storage-usage-consistency'
import { createImageHostingRepo } from './image-hosting'
import { createMatterRepo } from './matter'
import { createStorageUsageBreakdownRepo } from './storage-usage-breakdown'
import { matterAddedProjectionQueries } from './storage-usage-projection-mutations'

async function setup() {
  const test = await createTestApp()
  await authedHeaders(test.app, 'usage@example.com')
  const orgRows = await test.db.all<{ id: string }>(sql`SELECT id FROM organization LIMIT 1`)
  const orgId = orgRows[0].id
  const now = Date.now()
  await test.db.run(sql`
    INSERT INTO storages (
      id, bucket, endpoint, region, access_key, secret_key, file_path, custom_host,
      capacity, used, status, created_at, updated_at
    ) VALUES (
      'storage-1', 'bucket', 'https://s3.example.com', 'auto', 'key', 'secret', '',
      '', 0, 0, 'active', ${now}, ${now}
    )
  `)
  return { ...test, orgId }
}

describe('storage usage breakdown projection', () => {
  it('sorts category items before pagination', async () => {
    const { db, orgId } = await setup()
    const usage = createStorageUsageBreakdownRepo(db)
    const matter = createMatterRepo(db)

    for (const [name, size] of [
      ['charlie.pdf', 30],
      ['alpha.pdf', 10],
      ['bravo.pdf', 20],
    ] as const) {
      await matter.create({
        orgId,
        name,
        type: 'application/pdf',
        size,
        dirtype: DirType.FILE,
        parent: '',
        object: name,
        storageId: 'storage-1',
        status: ObjectStatus.ACTIVE,
      })
    }

    const byName = await usage.listItems(orgId, 'documents', 1, 2, 'name', 'asc')
    expect(byName.items.map((item) => item.name)).toEqual(['alpha.pdf', 'bravo.pdf'])
    expect(byName.total).toBe(3)

    const bySize = await usage.listItems(orgId, 'documents', 1, 3, 'size', 'desc')
    expect(bySize.items.map((item) => item.size)).toEqual([30, 20, 10])
  })

  it('initializes new spaces and moves file bytes through active, trash, restore, and purge', async () => {
    const { db, orgId } = await setup()
    const usage = createStorageUsageBreakdownRepo(db)
    const matter = createMatterRepo(db)

    expect((await usage.get(orgId)).breakdowns).toHaveLength(8)
    await expectStorageUsageConsistent(db, orgId, 'initial projection')
    const created = await matter.create({
      orgId,
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 120,
      dirtype: DirType.FILE,
      parent: '',
      object: 'photo.jpg',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
    })
    await expectStorageUsageConsistent(db, orgId, 'active create')
    let projection = await usage.get(orgId)
    expect(projection.breakdowns.find((row) => row.category === 'photos')).toMatchObject({
      bytes: 120,
      fileCount: 1,
    })

    await matter.trash(orgId, created.id)
    await expectStorageUsageConsistent(db, orgId, 'trash')
    projection = await usage.get(orgId)
    expect(projection.breakdowns.find((row) => row.category === 'photos')?.bytes).toBe(0)
    expect(projection.breakdowns.find((row) => row.category === 'trash')).toMatchObject({
      bytes: 120,
      fileCount: 1,
    })

    await matter.restore(orgId, created.id)
    await expectStorageUsageConsistent(db, orgId, 'restore')
    projection = await usage.get(orgId)
    expect(projection.breakdowns.find((row) => row.category === 'photos')?.bytes).toBe(120)
    expect(projection.breakdowns.find((row) => row.category === 'trash')?.bytes).toBe(0)

    await matter.trash(orgId, created.id)
    await matter.purge(orgId, [created.id])
    await expectStorageUsageConsistent(db, orgId, 'purge')
    projection = await usage.get(orgId)
    expect(projection.breakdowns.reduce((sum, row) => sum + row.bytes, 0)).toBe(0)
  })

  it('stays consistent across copy, resize, draft activation, recursive trash, conflicts, and image hosting', async () => {
    const { db, orgId } = await setup()
    const matter = createMatterRepo(db)
    const imageHosting = createImageHostingRepo(db)

    const source = await matter.create({
      orgId,
      name: 'guide.pdf',
      type: 'application/pdf',
      size: 80,
      dirtype: DirType.FILE,
      parent: '',
      object: 'guide.pdf',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
    })
    const copy = await matter.copy(source, '', 'guide-copy.pdf')
    await expectStorageUsageConsistent(db, orgId, 'copy')

    await matter.applyUpload(orgId, copy.id, { type: 'video/mp4', size: 240, object: 'guide-copy.mp4' })
    await expectStorageUsageConsistent(db, orgId, 'resize and MIME change')

    const draft = await matter.create({
      orgId,
      name: 'song.mp3',
      type: 'application/octet-stream',
      size: 60,
      dirtype: DirType.FILE,
      parent: '',
      object: 'song.mp3',
      storageId: 'storage-1',
      status: ObjectStatus.DRAFT,
    })
    expect(await matter.activateDraft(draft.id, orgId, draft.name, 'audio/mpeg', new Date())).toBe(true)
    await expectStorageUsageConsistent(db, orgId, 'draft activation')

    const folder = await matter.create({
      orgId,
      name: 'album',
      type: 'folder',
      size: 0,
      dirtype: DirType.USER_FOLDER,
      parent: '',
      object: '',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
    })
    await matter.create({
      orgId,
      name: 'inside.jpg',
      type: 'image/jpeg',
      size: 120,
      dirtype: DirType.FILE,
      parent: folder.name,
      object: 'inside.jpg',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
    })
    await matter.trash(orgId, folder.id)
    await expectStorageUsageConsistent(db, orgId, 'recursive trash')
    await matter.restore(orgId, folder.id)
    await expectStorageUsageConsistent(db, orgId, 'recursive restore')

    await matter.create({
      orgId,
      name: 'replace.txt',
      type: 'text/plain',
      size: 20,
      dirtype: DirType.FILE,
      parent: '',
      object: 'replace-old.txt',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
    })
    await matter.create({
      orgId,
      name: 'replace.txt',
      type: 'text/plain',
      size: 30,
      dirtype: DirType.FILE,
      parent: '',
      object: 'replace-new.txt',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
      onConflict: 'replace',
    })
    await expectStorageUsageConsistent(db, orgId, 'replace conflict')

    const image = await imageHosting.create({
      orgId,
      path: 'covers/cover.png',
      mime: 'image/png',
      size: 75,
      storageId: 'storage-1',
      status: 'draft',
    })
    expect(await imageHosting.setActive(image.id, orgId)).toBe(true)
    await expectStorageUsageConsistent(db, orgId, 'image hosting activation')
    await imageHosting.delete(image.id, orgId)
    await expectStorageUsageConsistent(db, orgId, 'image hosting purge')
  })

  it('rolls projection mutations back when the surrounding transaction fails', async () => {
    const { db, orgId } = await setup()
    const matter = createMatterRepo(db)
    const photo = await matter.create({
      orgId,
      name: 'rollback.jpg',
      type: 'image/jpeg',
      size: 90,
      dirtype: DirType.FILE,
      parent: '',
      object: 'rollback.jpg',
      storageId: 'storage-1',
      status: ObjectStatus.ACTIVE,
    })
    await expectStorageUsageConsistent(db, orgId, 'before failed transaction')

    await expect(
      executeWriteTransaction(db, [
        ...matterAddedProjectionQueries(db, orgId, photo.id),
        db.insert(storageUsageBreakdowns).values({
          orgId,
          category: 'photos',
          bytes: 0,
          fileCount: 0,
          updatedAt: new Date(),
        }),
      ]),
    ).rejects.toThrow()

    await expectStorageUsageConsistent(db, orgId, 'after failed transaction')
  })

  it('preserves the invariant through a deterministic state-machine sequence', async () => {
    const { db, orgId } = await setup()
    const matter = createMatterRepo(db)
    const states = new Map<string, 'active' | 'trash' | 'purged'>()
    let seed = 0x5a17c0de
    let sequence = 0

    function next(): number {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed
    }

    function idsWithState(state: 'active' | 'trash'): string[] {
      return [...states].filter(([, value]) => value === state).map(([id]) => id)
    }

    for (let step = 0; step < 80; step += 1) {
      const activeIds = idsWithState('active')
      const trashIds = idsWithState('trash')
      const operation = next() % 6
      let label: string

      if (operation === 0 || activeIds.length + trashIds.length === 0) {
        const types = ['image/jpeg', 'video/mp4', 'audio/mpeg', 'application/pdf', 'application/zip', 'x/custom']
        const type = types[next() % types.length]
        const created = await matter.create({
          orgId,
          name: `state-${sequence}.${sequence % 2 === 0 ? 'bin' : 'dat'}`,
          type,
          size: (next() % 4096) + 1,
          dirtype: DirType.FILE,
          parent: '',
          object: `state-${sequence}`,
          storageId: 'storage-1',
          status: ObjectStatus.ACTIVE,
        })
        sequence += 1
        states.set(created.id, 'active')
        label = `step ${step}: create ${type}`
      } else if (operation === 1 && activeIds.length > 0) {
        const id = activeIds[next() % activeIds.length]
        await matter.trashByIds(orgId, [id])
        states.set(id, 'trash')
        label = `step ${step}: bulk trash`
      } else if (operation === 2 && trashIds.length > 0) {
        const id = trashIds[next() % trashIds.length]
        await matter.restoreActiveByIds(orgId, [id])
        states.set(id, 'active')
        label = `step ${step}: bulk restore`
      } else if (operation === 3 && activeIds.length > 0) {
        const id = activeIds[next() % activeIds.length]
        const type = next() % 2 === 0 ? 'image/webp' : 'application/pdf'
        await matter.applyUpload(orgId, id, {
          type,
          size: (next() % 8192) + 1,
          object: `updated-${step}`,
        })
        label = `step ${step}: resize ${type}`
      } else if (operation === 4 && activeIds.length > 0) {
        const id = activeIds[next() % activeIds.length]
        const source = await matter.get(id, orgId)
        if (!source) throw new Error(`state_machine_missing_source:${id}`)
        const copied = await matter.copy(source, '', `copy-${step}`, { onConflict: 'rename' })
        states.set(copied.id, 'active')
        label = `step ${step}: copy`
      } else if (trashIds.length > 0) {
        const id = trashIds[next() % trashIds.length]
        await matter.purge(orgId, [id])
        states.set(id, 'purged')
        label = `step ${step}: purge`
      } else {
        const id = activeIds[next() % activeIds.length]
        await matter.trash(orgId, id)
        states.set(id, 'trash')
        label = `step ${step}: trash`
      }

      await expectStorageUsageConsistent(db, orgId, `seed=0x5a17c0de ${label}`)
    }
  })
})
