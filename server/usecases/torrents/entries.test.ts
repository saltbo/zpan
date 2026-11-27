import { describe, expect, it } from 'vitest'
import type { DownloadTaskRecord, TorrentRecord, WorkspaceTorrentView } from '../ports'
import {
  entryState,
  stateTaskIds,
  TORRENT_EVICTED_MESSAGE,
  TORRENT_INVALID_MESSAGE,
  TORRENT_NOT_KEPT_MESSAGE,
  TORRENT_STOPPED_MESSAGE,
} from './entries'

const now = new Date('2026-11-01T00:00:00Z')

function view(overrides: Partial<WorkspaceTorrentView> = {}): WorkspaceTorrentView {
  return {
    id: 'e1',
    orgId: 'org',
    torrentId: null,
    infoHash: null,
    source: 'stremthru',
    sourceUri: 'magnet:?xt=urn:btih:x',
    displayName: null,
    taskId: null,
    status: 'resolving',
    error: null,
    createdByActorType: 'api_key',
    createdByActorRef: 'k',
    createdByActorIssuer: null,
    lastPlayedAt: null,
    createdAt: now,
    updatedAt: now,
    torrent: null,
    ...overrides,
  }
}

function torrent(status: TorrentRecord['status'], sourceTaskId: string | null = 'fill'): TorrentRecord {
  return {
    id: 't1',
    infoHash: 'ab'.repeat(20),
    storageId: 's',
    name: 'T',
    totalSize: 1,
    fileCount: 1,
    private: false,
    status,
    verified: null,
    sourceTaskId,
    sourceDownloaderId: null,
    lastAccessedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

function task(id: string, status: string, overrides: Partial<DownloadTaskRecord> = {}): DownloadTaskRecord {
  return { id, status, deletedAt: null, errorMessage: null, torrentId: null, ...overrides } as DownloadTaskRecord
}

const tasks = (...list: DownloadTaskRecord[]) => new Map(list.map((item) => [item.id, item]))

describe('entryState', () => {
  it('follows the torrent once the entry has one', () => {
    expect(entryState(view({ torrent: torrent('ready') }), tasks())).toEqual({ status: 'ready', error: null })
    expect(entryState(view({ torrent: torrent('verifying') }), tasks())).toEqual({ status: 'verifying', error: null })
    expect(entryState(view({ torrent: torrent('invalid') }), tasks())).toEqual({
      status: 'failed',
      error: TORRENT_INVALID_MESSAGE,
    })
    expect(entryState(view({ torrent: torrent('evicting') }), tasks())).toEqual({
      status: 'failed',
      error: TORRENT_EVICTED_MESSAGE,
    })
  })

  it('downloads while its own task or the torrent’s filler runs, and fails once both stopped', () => {
    const downloading = view({ torrent: torrent('downloading'), taskId: 'own' })
    expect(entryState(downloading, tasks(task('own', 'downloading'))).status).toBe('downloading')
    expect(entryState(downloading, tasks(task('own', 'completed'), task('fill', 'downloading'))).status).toBe(
      'downloading',
    )
    expect(entryState(downloading, tasks(task('own', 'failed', { errorMessage: 'tracker down' })))).toEqual({
      status: 'failed',
      error: 'tracker down',
    })
    expect(entryState(view({ torrent: torrent('downloading') }), tasks(task('fill', 'canceled')))).toEqual({
      status: 'failed',
      error: TORRENT_STOPPED_MESSAGE,
    })
    // A filler that moved on to another torrent no longer fills this one.
    expect(
      entryState(view({ torrent: torrent('downloading') }), tasks(task('fill', 'downloading', { torrentId: 'other' })))
        .status,
    ).toBe('failed')
  })

  it('shows what happens before there is a torrent', () => {
    expect(entryState(view(), tasks()).status).toBe('resolving')
    expect(entryState(view({ status: 'failed', error: 'gone' }), tasks())).toEqual({ status: 'failed', error: 'gone' })
    expect(entryState(view({ taskId: 'own' }), tasks(task('own', 'canceled', { deletedAt: now }))).status).toBe(
      'failed',
    )
    expect(entryState(view({ taskId: 'own' }), tasks(task('own', 'completed')))).toEqual({
      status: 'failed',
      error: TORRENT_NOT_KEPT_MESSAGE,
    })
  })

  it('loads the tasks an entry’s state depends on', () => {
    expect(
      stateTaskIds([
        view({ taskId: 'own', torrent: torrent('downloading') }),
        view({ taskId: 'own', torrent: torrent('ready', 'old') }),
      ]),
    ).toEqual(['own', 'fill'])
  })
})
