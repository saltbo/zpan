import { describe, expect, it } from 'vitest'
import { toDownloadTaskListItem } from './download-task'
import type { DownloadTask } from './schemas/downloads'

describe('toDownloadTaskListItem', () => {
  it('keeps list fields and strips detail-only runtime data without mutating the task', () => {
    const runtime = {
      engine: 'aria2' as const,
      state: 'active',
      phase: 'downloading' as const,
      message: 'downloading',
      etaSeconds: 42,
      torrent: { infoHash: 'hash', name: 'archive', peers: 3 },
      trackers: [{ url: 'udp://tracker.example', status: 'working' }],
      peers: [{ address: '127.0.0.1:6881', client: 'test' }],
      files: [{ path: 'archive/file.txt', size: 10 }],
    }
    const task = {
      id: 'task-1',
      status: { runtime },
    } as unknown as DownloadTask

    const item = toDownloadTaskListItem(task)

    expect(item.id).toBe('task-1')
    expect(item.status.runtime).toEqual({
      phase: 'downloading',
      etaSeconds: 42,
      torrent: { infoHash: 'hash', name: 'archive', peers: 3 },
    })
    expect(task.status.runtime).toBe(runtime)
    expect(task.status.runtime?.trackers).toHaveLength(1)
  })

  it('preserves a null runtime', () => {
    const task = {
      id: 'task-1',
      status: { runtime: null },
    } as unknown as DownloadTask

    expect(toDownloadTaskListItem(task).status.runtime).toBeNull()
  })
})
