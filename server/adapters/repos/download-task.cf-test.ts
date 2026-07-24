import { env } from 'cloudflare:workers'
import { sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { describe, expect, it } from 'vitest'
import { createCloudflarePlatform } from '../../platform/cloudflare'
import { createDownloadTaskRepo } from './download-task'

describe('[CF] download task events', () => {
  it('stores integer event fields as JSON integers', async () => {
    const db = createCloudflarePlatform(env).db
    const repo = createDownloadTaskRepo(db)
    const taskId = `task-${nanoid()}`
    const createdAt = new Date('2026-07-24T12:00:00.000Z')

    await repo.insert({
      id: taskId,
      orgId: `org-${nanoid()}`,
      createdByUserId: `user-${nanoid()}`,
      sourceType: 'http',
      sourceUri: 'https://example.com/file.bin',
      displayName: 'file.bin',
      targetFolder: '',
      category: 'test',
      tags: [],
      assignedDownloaderId: null,
      status: 'queued',
      assignedAt: null,
      now: createdAt,
    })
    await repo.setFields(taskId, {
      status: 'assigned',
      billingChargedBytes: 512,
      runtime: JSON.stringify({
        progress: {
          download: { bytes: 256, totalBytes: 1024, bytesPerSecond: 64 },
          upload: { bytes: 0, totalBytes: null, bytesPerSecond: 0 },
        },
      }),
      updatedAt: new Date('2026-07-24T12:01:00.000Z'),
    })

    const rows = await db.all<{
      attemptType: string
      billedBytesType: string
      occurredAtType: string
      transferredBytesType: string
    }>(sql`
      SELECT
        json_type(task_event.value, '$.occurredAt') AS occurredAtType,
        json_type(task_event.value, '$.attempt') AS attemptType,
        json_type(task_event.value, '$.transferredBytes') AS transferredBytesType,
        json_type(task_event.value, '$.billedBytes') AS billedBytesType
      FROM download_tasks task
      JOIN json_each(task.events) task_event
      WHERE task.id = ${taskId}
      ORDER BY CAST(task_event.key AS INTEGER) DESC
      LIMIT 1
    `)

    expect(rows).toEqual([
      {
        occurredAtType: 'integer',
        attemptType: 'integer',
        transferredBytesType: 'integer',
        billedBytesType: 'integer',
      },
    ])
  })
})
