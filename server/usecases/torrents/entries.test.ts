import { describe, expect, it, vi } from 'vitest'
import type {
  DownloadTaskRecord,
  TorrentRecord,
  WorkspaceTorrentRecord,
  WorkspaceTorrentUpdate,
  WorkspaceTorrentView,
} from '../ports'
import {
  attachWaitingEntries,
  type EntryDeps,
  entryState,
  failWaitingEntries,
  loadStateTasks,
  resolveTaskEntry,
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
    status: 'active',
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

  it('pauses while the download waits to be resumed, and says when credits ran out', () => {
    const suspended = task('own', 'suspended', { orgId: 'org', billingStatus: 'insufficient_credits' })
    // Before the torrent is known, as when a StremThru add found no credits.
    expect(entryState(view({ taskId: 'own' }), tasks(suspended))).toEqual({
      status: 'paused',
      error: null,
      pauseReason: 'insufficient_credits',
    })
    for (const status of ['paused', 'pausing']) {
      expect(entryState(view({ taskId: 'own' }), tasks(task('own', status)))).toEqual({
        status: 'paused',
        error: null,
        pauseReason: 'paused',
      })
    }
    const downloading = view({ torrent: torrent('downloading'), taskId: 'own' })
    expect(entryState(downloading, tasks(suspended)).pauseReason).toBe('insufficient_credits')
    // The torrent's filler still runs, so the torrent still downloads.
    expect(entryState(downloading, tasks(suspended, task('fill', 'downloading'))).status).toBe('downloading')
  })

  it('pauses while it waits on a paused filler, keeping another workspace’s reason private', () => {
    const waiting = view({ torrent: torrent('downloading') })
    const ownFiller = task('fill', 'suspended', { orgId: 'org', billingStatus: 'insufficient_credits' })
    expect(entryState(waiting, tasks(ownFiller)).pauseReason).toBe('insufficient_credits')
    const otherFiller = task('fill', 'suspended', { orgId: 'other', billingStatus: 'insufficient_credits' })
    expect(entryState(waiting, tasks(otherFiller))).toEqual({ status: 'paused', error: null, pauseReason: 'paused' })
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

// An in-memory store of entries that keeps the unique (org_id, torrent_id) and
// (org_id, info_hash) the way the database does.
function entryStore(initial: WorkspaceTorrentRecord[], taskList: DownloadTaskRecord[] = [], filled?: TorrentRecord) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]))
  const clash = (row: WorkspaceTorrentRecord) =>
    [...rows.values()].some(
      (other) =>
        other.id !== row.id &&
        other.orgId === row.orgId &&
        ((row.torrentId && other.torrentId === row.torrentId) || (row.infoHash && other.infoHash === row.infoHash)),
    )
  const findRecords = vi.fn(async (ids: readonly string[]) => taskList.filter((item) => ids.includes(item.id)))
  const deps = {
    workspaceTorrents: {
      async listWaiting(infoHash: string) {
        return [...rows.values()].filter((row) => row.infoHash === infoHash && !row.torrentId)
      },
      async listByTorrent(torrentId: string) {
        return [...rows.values()].filter((row) => row.torrentId === torrentId)
      },
      async findByInfoHash(orgId: string, infoHash: string) {
        return [...rows.values()].find((row) => row.orgId === orgId && row.infoHash === infoHash) ?? null
      },
      async findByTask(taskId: string) {
        return [...rows.values()].find((row) => row.taskId === taskId) ?? null
      },
      async update(id: string, fields: WorkspaceTorrentUpdate) {
        const row = rows.get(id)
        if (!row) return
        const next = { ...row, ...fields } as WorkspaceTorrentRecord
        if (clash(next)) throw new Error('UNIQUE constraint failed')
        rows.set(id, next)
      },
      async delete(id: string) {
        rows.delete(id)
      },
    },
    torrents: { get: async () => filled ?? null },
    downloadTasks: {
      findRecords,
      findRecord: async (id: string) => taskList.find((item) => item.id === id) ?? null,
    },
  } as unknown as EntryDeps
  return { deps, rows, findRecords }
}

const hash = 'ab'.repeat(20)

describe('entries as downloads move them along', () => {
  it('loads every task a page of entries depends on in one batch', async () => {
    const { deps, findRecords } = entryStore([], [task('own', 'downloading'), task('fill', 'downloading')])
    const views = [
      view({ id: 'e1', taskId: 'own', torrent: torrent('downloading') }),
      view({ id: 'e2', taskId: 'own' }),
    ]

    const loaded = await loadStateTasks(deps, views)

    expect(findRecords).toHaveBeenCalledTimes(1)
    expect([...loaded.keys()].sort()).toEqual(['fill', 'own'])
    expect(await loadStateTasks(deps, [view()])).toEqual(new Map())
    expect(findRecords).toHaveBeenCalledTimes(1)
  })

  it('merges a waiting entry into the entry its workspace already holds the torrent in', async () => {
    const holder = view({ id: 'holder', torrentId: 't1', infoHash: null, source: 'stremthru', taskId: null })
    const waiting = view({ id: 'waiting', infoHash: hash, source: 'download', taskId: 'remote' })
    const elsewhere = view({ id: 'other', orgId: 'org-b', infoHash: hash })
    const { deps, rows } = entryStore([holder, waiting, elsewhere])

    await attachWaitingEntries(deps, torrent('downloading'), now)

    expect([...rows.keys()].sort()).toEqual(['holder', 'other'])
    expect(rows.get('holder')).toMatchObject({ torrentId: 't1', infoHash: hash, source: 'download', taskId: 'remote' })
    expect(rows.get('other')).toMatchObject({ torrentId: 't1' })
  })

  it('merges instead of failing when a concurrent add takes the torrent first', async () => {
    const holder = view({ id: 'holder', torrentId: 't1', infoHash: null, source: 'download', taskId: 'remote' })
    const waiting = view({ id: 'waiting', infoHash: hash, taskId: null })
    const { deps, rows } = entryStore([holder, waiting])
    // The holder is not there yet when the entry is looked at, and is when its update runs.
    vi.spyOn(deps.workspaceTorrents, 'listByTorrent').mockResolvedValueOnce([])

    await attachWaitingEntries(deps, torrent('downloading'), now)

    expect([...rows.keys()]).toEqual(['holder'])
    expect(rows.get('holder')).toMatchObject({ torrentId: 't1', source: 'download', taskId: 'remote' })
  })

  it('rethrows an update failure that no other entry explains', async () => {
    const { deps } = entryStore([view({ id: 'waiting', infoHash: hash })])
    vi.spyOn(deps.workspaceTorrents, 'update').mockRejectedValueOnce(new Error('disk I/O error'))

    await expect(attachWaitingEntries(deps, torrent('downloading'), now)).rejects.toThrow('disk I/O error')
  })

  it('keeps a download entry’s source when the filling task’s entry absorbs it', async () => {
    const fillEntry = view({ id: 'fill-entry', source: 'stremthru', taskId: 'fill', sourceUri: 'https://x/t.torrent' })
    const holder = view({ id: 'holder', torrentId: 't1', infoHash: hash, source: 'download', taskId: 'remote' })
    const { deps, rows } = entryStore([fillEntry, holder])

    await resolveTaskEntry(deps, task('fill', 'downloading', { orgId: 'org' }), torrent('downloading', 'fill'), now)

    expect([...rows.keys()]).toEqual(['fill-entry'])
    expect(rows.get('fill-entry')).toMatchObject({
      torrentId: 't1',
      source: 'download',
      taskId: 'fill',
      status: 'active',
    })
  })

  it('gives entries of other workspaces the generic message when a fill stops', async () => {
    const own = view({ id: 'own', torrentId: 't1', taskId: 'fill' })
    const waiting = view({ id: 'waiting', orgId: 'org-b', torrentId: 't1' })
    const filled = torrent('downloading', 'fill')
    const { deps, rows } = entryStore([own, waiting], [], filled)

    await failWaitingEntries(
      deps,
      task('fill', 'failed', { orgId: 'org', torrentRole: 'fill', torrentId: 't1' }),
      '/srv/org/secret: disk full',
      now,
    )

    expect(rows.get('own')).toMatchObject({ status: 'failed', error: '/srv/org/secret: disk full' })
    expect(rows.get('waiting')).toMatchObject({ status: 'failed', error: TORRENT_STOPPED_MESSAGE })
  })

  it('keeps an entry whose torrent is ready when its own download stops afterwards', async () => {
    // Another workspace's fill made the torrent ready while this workspace's own
    // download still ran; that download then fails.
    const ready = torrent('ready', 'fill')
    const own = view({ id: 'own', torrentId: 't1', taskId: 'remote', source: 'download' })
    const { deps, rows } = entryStore([own], [], ready)

    await failWaitingEntries(deps, task('remote', 'failed', { orgId: 'org', torrentId: 't1' }), 'disk full', now)

    expect(rows.get('own')).toMatchObject({ status: 'active', error: null })
    expect(entryState({ ...(rows.get('own') as WorkspaceTorrentRecord), torrent: ready }, tasks())).toEqual({
      status: 'ready',
      error: null,
    })
  })

  it('stores only whether an entry failed, whatever its torrent does', async () => {
    const waiting = view({ id: 'waiting', infoHash: hash, source: 'download', taskId: 'remote' })
    const { deps, rows } = entryStore([waiting])

    await attachWaitingEntries(deps, torrent('downloading'), now)
    expect(rows.get('waiting')).toMatchObject({ torrentId: 't1', status: 'active' })
  })
})
