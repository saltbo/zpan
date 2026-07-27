import { describe, expect, it } from 'vitest'
import { createTestApp } from '../../test/setup'
import { createResourceChangeRepo, resourceChangeQuery } from './resource-change'

describe('resource change repository', () => {
  it('lists scoped changes after a sequence and filters resource types', async () => {
    const { db } = await createTestApp()
    await resourceChangeQuery(db, {
      scopeType: 'organization',
      scopeId: 'org-1',
      resourceType: 'object',
      resourceId: 'object-1',
      changeType: 'upsert',
      action: 'created',
      metadata: { parent: 'root' },
      occurredAt: new Date(100),
    })
    await resourceChangeQuery(db, {
      scopeType: 'organization',
      scopeId: 'org-1',
      resourceType: 'notification',
      resourceId: 'notification-1',
      changeType: 'delete',
      occurredAt: new Date(200),
    })
    await resourceChangeQuery(db, {
      scopeType: 'organization',
      scopeId: 'org-2',
      resourceType: 'object',
      resourceId: 'object-2',
      changeType: 'upsert',
      occurredAt: new Date(300),
    })

    const repo = createResourceChangeRepo(db)
    const all = await repo.listAfter({
      scopeType: 'organization',
      scopeId: 'org-1',
      sequence: 0,
      limit: 10,
    })
    const objects = await repo.listAfter({
      scopeType: 'organization',
      scopeId: 'org-1',
      resourceTypes: ['object'],
      sequence: 0,
      limit: 10,
    })

    expect(all).toEqual([
      expect.objectContaining({
        resourceId: 'object-1',
        action: 'created',
        metadata: { parent: 'root' },
      }),
      expect.objectContaining({
        resourceId: 'notification-1',
        action: null,
        metadata: null,
      }),
    ])
    expect(objects.map((change) => change.resourceId)).toEqual(['object-1'])
    await expect(
      repo.listAfter({
        scopeType: 'organization',
        scopeId: 'org-1',
        resourceTypes: [],
        sequence: 0,
        limit: 10,
      }),
    ).resolves.toEqual([])
  })

  it('reports sequence bounds for scoped resource types', async () => {
    const { db } = await createTestApp()
    await resourceChangeQuery(db, {
      scopeType: 'user',
      scopeId: 'user-1',
      resourceType: 'notification',
      resourceId: 'notification-1',
      changeType: 'upsert',
      occurredAt: new Date(100),
    })
    await resourceChangeQuery(db, {
      scopeType: 'user',
      scopeId: 'user-1',
      resourceType: 'object',
      resourceId: 'object-1',
      changeType: 'upsert',
      occurredAt: new Date(200),
    })

    const repo = createResourceChangeRepo(db)
    const notification = await repo.listAfter({
      scopeType: 'user',
      scopeId: 'user-1',
      resourceTypes: ['notification'],
      sequence: 0,
      limit: 1,
    })

    await expect(repo.oldestSequence({ scopeType: 'user', scopeId: 'user-1' })).resolves.toBe(1)
    await expect(
      repo.oldestSequence({
        scopeType: 'user',
        scopeId: 'user-1',
        resourceTypes: ['notification'],
      }),
    ).resolves.toBe(notification[0]?.sequence)
    await expect(repo.oldestSequence({ scopeType: 'user', scopeId: 'user-1', resourceTypes: [] })).resolves.toBeNull()
    await expect(repo.oldestSequence({ scopeType: 'user', scopeId: 'missing' })).resolves.toBeNull()
    await expect(repo.latestSequence({ scopeType: 'user', scopeId: 'user-1' })).resolves.toBe(2)
    await expect(repo.latestSequence({ scopeType: 'user', scopeId: 'missing' })).resolves.toBe(0)
  })

  it('purges changes strictly before the cutoff and returns the deleted count', async () => {
    const { db } = await createTestApp()
    for (const [resourceId, occurredAt] of [
      ['old-1', 100],
      ['old-2', 199],
      ['boundary', 200],
    ] as const) {
      await resourceChangeQuery(db, {
        scopeType: 'organization',
        scopeId: 'org-1',
        resourceType: 'object',
        resourceId,
        changeType: 'upsert',
        occurredAt: new Date(occurredAt),
      })
    }

    const repo = createResourceChangeRepo(db)

    await expect(repo.purgeBefore(new Date(200))).resolves.toBe(2)
    await expect(
      repo.listAfter({
        scopeType: 'organization',
        scopeId: 'org-1',
        sequence: 0,
        limit: 10,
      }),
    ).resolves.toEqual([expect.objectContaining({ resourceId: 'boundary' })])
    await expect(repo.purgeBefore(new Date(100))).resolves.toBe(0)
  })
})
