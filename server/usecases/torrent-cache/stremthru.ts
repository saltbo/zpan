// The StremThru Store API over the torrent cache (docs/design/torrent-cache.md
// §8, §10, §12). A `stremthru` API key names one user in one workspace; addons
// check which infoHashes are cached, add torrents (served by instant transfer
// when cached), list and remove them, and generate playback links. Removing a
// torrent trashes its files; only eviction ever deletes cached bytes.

import { ApiKeyTemplate } from '@shared/api-key-templates'
import { DirType } from '@shared/constants'
import { hasFeature } from '../../domain/licensing'
import {
  decodeFileLink,
  encodeFileLink,
  magnetFor,
  parseCheckHash,
  STREMTHRU_CHECK_MAX_HASHES,
  STREMTHRU_LINK_REUSE_MIN_REMAINING_MS,
  STREMTHRU_LINK_TTL_SECONDS,
  STREMTHRU_LIST_DEFAULT_LIMIT,
  STREMTHRU_LIST_MAX_LIMIT,
  StremThruError,
  type StremThruErrorCode,
  type StremThruFile,
  type StremThruTorzStatus,
  torzFile,
  torzSource,
  torzStatus,
} from '../../domain/stremthru'
import { isTorrentCacheKey, TORRENT_CACHE_PREFIX, torrentTreeRoot } from '../../domain/torrent-cache'
import type { Database } from '../../platform/interface'
import type { Deps } from '../deps'
import { createDownloadTask, performDownloadTaskAction } from '../downloads/downloads'
import { isWithinDownloadTarget } from '../object'
import {
  type ApiKeyAuth,
  ApiKeyRateLimitError,
  AppError,
  DownloadError,
  type DownloadTaskRecord,
  type Matter,
  type TorrentFileRecord,
  type TorrentRecord,
} from '../ports'
import { loadBindingState } from '../site/licensing'
import { confirmDownloadTraffic, meterDownloadTraffic, reverseDownloadTraffic } from '../store/traffic-metering'
import { createTrafficEventId, recordDownloadIssued } from '../transfer-activity'
import { getTorrentFolder } from './config'

const TORRENT_SOURCE_TYPES = ['magnet', 'torrent_url'] as const
const WRITE_ROLES = ['owner', 'admin', 'editor']
const TERMINAL_STATUSES = ['completed', 'failed', 'canceled']
const NOT_REUSABLE_STATUSES = ['failed', 'canceled', 'canceling']
const TREE_PAGE_SIZE = 1000

export interface StoreCaller {
  keyId: string
  userId: string
  orgId: string
}

export interface StoreUser {
  id: string
  email: string
  subscription_status: 'premium'
  has_usenet: false
}

export interface CheckItem {
  hash: string
  magnet: string
  status: StremThruTorzStatus
  files: StremThruFile[]
}

export interface Torz {
  id: string
  hash: string
  magnet: string
  name: string
  size: number
  status: StremThruTorzStatus
  private: boolean
  files: StremThruFile[]
  added_at: string
}

export type TorzListItem = Omit<Torz, 'files' | 'magnet'>

// ─── Authentication ──────────────────────────────────────────────────────────

// Resolves the key to its user and workspace. A missing, unknown, or revoked key
// is UNAUTHORIZED; a key of another template or a user who can no longer write
// to the workspace is FORBIDDEN; an instance without the torrent_cache
// entitlement is PAYMENT_REQUIRED.
export async function authenticateStoreCaller(
  deps: Pick<Deps, 'apiKeys' | 'userAdmin' | 'org' | 'licenseBinding' | 'licenseCloudBaseUrl'>,
  params: { auth: ApiKeyAuth; db: Database; token: string | null },
): Promise<StoreCaller> {
  if (!params.token) throw new StremThruError('UNAUTHORIZED', 'Missing store token')
  let key: Awaited<ReturnType<Deps['apiKeys']['verifyApiKey']>>
  try {
    key = await deps.apiKeys.verifyApiKey(params.auth, params.db, params.token, ApiKeyTemplate.STREMTHRU)
  } catch (error) {
    if (error instanceof ApiKeyRateLimitError) throw new StremThruError('TOO_MANY_REQUESTS', error.message)
    throw error
  }
  if (!key) throw new StremThruError('UNAUTHORIZED', 'Invalid store token')
  if (key.configId !== ApiKeyTemplate.STREMTHRU || key.scope.mode !== 'workspace') {
    throw new StremThruError('FORBIDDEN', 'This key is not a StremThru key')
  }
  const userId = key.referenceId
  const orgId = key.scope.orgId
  if (await deps.userAdmin.isBanned(userId)) throw new StremThruError('UNAUTHORIZED', 'Invalid store token')
  const role = await deps.org.getMemberRole(orgId, userId)
  const canWrite = role ? WRITE_ROLES.includes(role) : (await deps.org.findPersonalOrg(userId)) === orgId
  if (!canWrite) throw new StremThruError('FORBIDDEN', 'The key no longer has access to its workspace')
  if (!hasFeature('torrent_cache', await loadBindingState(deps))) {
    throw new StremThruError('PAYMENT_REQUIRED', 'The torrent cache needs a Pro or Business license')
  }
  return { keyId: key.id, userId, orgId }
}

// Addons only read subscription_status; the email stays private to the instance.
export function getStoreUser(caller: StoreCaller): StoreUser {
  return { id: caller.userId, email: '', subscription_status: 'premium', has_usenet: false }
}

// ─── Check ───────────────────────────────────────────────────────────────────

// Only ready torrents are cached; anything else, including torrents still
// downloading or verifying, is unknown.
export async function checkTorz(deps: Pick<Deps, 'torrents'>, rawHashes: readonly string[]): Promise<CheckItem[]> {
  const requested = rawHashes.map((value) => value.trim()).filter(Boolean)
  if (requested.length === 0) throw new StremThruError('BAD_REQUEST', 'At least one hash is required')
  if (requested.length > STREMTHRU_CHECK_MAX_HASHES) {
    throw new StremThruError('BAD_REQUEST', `At most ${STREMTHRU_CHECK_MAX_HASHES} hashes can be checked at once`)
  }
  const parsed = requested.map((raw) => ({ raw, hash: parseCheckHash(raw) }))
  const hashes = parsed.flatMap((item) => (item.hash ? [item.hash] : []))
  const ready = (await deps.torrents.listByInfoHashes(hashes)).filter((torrent) => torrent.status === 'ready')
  const byHash = new Map(ready.map((torrent) => [torrent.infoHash, torrent]))
  const files = groupFiles(await deps.torrents.listFilesOf(ready.map((torrent) => torrent.id)))
  return parsed.map(({ raw, hash }) => {
    const torrent = hash ? byHash.get(hash) : undefined
    if (!torrent || !hash) {
      return { hash: hash ?? raw.toLowerCase(), magnet: hash ? magnetFor(hash) : '', status: 'unknown', files: [] }
    }
    return {
      hash,
      magnet: magnetFor(hash),
      status: 'cached',
      files: (files.get(torrent.id) ?? []).map((file) => torzFile(file)),
    }
  })
}

function groupFiles(files: readonly TorrentFileRecord[]): Map<string, TorrentFileRecord[]> {
  const grouped = new Map<string, TorrentFileRecord[]>()
  for (const file of files) grouped.set(file.torrentId, [...(grouped.get(file.torrentId) ?? []), file])
  return grouped
}

// ─── Torz items (the caller's torrent download tasks) ────────────────────────

async function torrentOf(deps: Pick<Deps, 'torrents'>, task: DownloadTaskRecord): Promise<TorrentRecord | null> {
  if (task.torrentId) {
    const torrent = await deps.torrents.get(task.torrentId)
    if (torrent) return torrent
  }
  return task.infoHash ? deps.torrents.getByInfoHash(task.infoHash) : null
}

// The caller's drive files that hold the task's torrent, keyed by object key.
async function heldFiles(
  deps: Pick<Deps, 'torrents'>,
  task: DownloadTaskRecord,
  torrent: TorrentRecord,
): Promise<Map<string, Matter>> {
  const refs = await deps.torrents.listWorkspaceReferences(task.orgId, torrent)
  const held = new Map<string, Matter>()
  for (const ref of refs) {
    // Only cached files have keys under bt/; a copy elsewhere belongs to another task.
    if (isWithinDownloadTarget(ref.parent, task.targetFolder) && !held.has(ref.object)) held.set(ref.object, ref)
  }
  return held
}

async function toTorz(deps: Pick<Deps, 'torrents'>, task: DownloadTaskRecord): Promise<Torz> {
  const torrent = await torrentOf(deps, task)
  const hash = torrent?.infoHash ?? task.infoHash ?? ''
  const status = torzStatus(task.status)
  let files: StremThruFile[] = []
  if (torrent && status === 'downloaded') {
    const held = await heldFiles(deps, task, torrent)
    files = (await deps.torrents.listFiles(torrent.id)).map((file) => {
      const matter = held.get(file.objectKey)
      return torzFile(file, matter ? encodeFileLink(matter.id) : undefined)
    })
  }
  return {
    id: task.id,
    hash,
    magnet: task.sourceType === 'magnet' ? task.sourceUri : hash ? magnetFor(hash) : '',
    name: torrent?.name ?? task.displayName ?? hash,
    size: torrent?.totalSize ?? 0,
    status,
    private: torrent?.private ?? false,
    files,
    added_at: task.createdAt.toISOString(),
  }
}

async function callerTask(deps: Pick<Deps, 'downloadTasks'>, caller: StoreCaller, id: string) {
  const task = await deps.downloadTasks.findRecord(id)
  if (
    !task ||
    task.orgId !== caller.orgId ||
    task.createdByUserId !== caller.userId ||
    task.deletedAt ||
    !(TORRENT_SOURCE_TYPES as readonly string[]).includes(task.sourceType)
  ) {
    throw new StremThruError('NOT_FOUND', 'Torz not found')
  }
  return task
}

// A completed task still counts as added while every file of its torrent is
// held; otherwise adding the torrent again transfers it again.
async function reusableTask(deps: Deps, caller: StoreCaller, infoHash: string): Promise<DownloadTaskRecord | null> {
  const task = await deps.downloadTasks.findLatestByInfoHash({
    orgId: caller.orgId,
    userId: caller.userId,
    infoHash,
    excludeStatuses: NOT_REUSABLE_STATUSES,
  })
  if (!task || !(TORRENT_SOURCE_TYPES as readonly string[]).includes(task.sourceType)) return null
  if (task.status !== 'completed') return task
  const torrent = await torrentOf(deps, task)
  if (!torrent) return null
  const held = await heldFiles(deps, task, torrent)
  const files = await deps.torrents.listFiles(torrent.id)
  return files.every((file) => held.has(file.objectKey)) ? task : null
}

// Adds a magnet or .torrent link as a download task into the workspace torrent
// folder. A ready torrent completes at once by instant transfer.
export async function addTorz(deps: Deps, caller: StoreCaller, link: string | undefined): Promise<Torz> {
  const source = link ? torzSource(link) : null
  if (!source) throw new StremThruError('BAD_REQUEST', 'A magnet link or torrent URL is required')
  const infoHash = source.type === 'magnet' ? parseCheckHash(source.uri) : null
  if (infoHash) {
    const existing = await reusableTask(deps, caller, infoHash)
    if (existing) return toTorz(deps, existing)
  }
  const targetFolder = await getTorrentFolder(deps, caller.orgId)
  const task = await withStoreErrors(() =>
    createDownloadTask(
      deps,
      caller.orgId,
      caller.userId,
      { source, targetFolder },
      { type: 'api_key', ref: caller.keyId, issuer: null },
    ),
  )
  return toTorz(deps, await deps.downloadTasks.getRecord(caller.orgId, task.id))
}

export async function listTorz(
  deps: Pick<Deps, 'downloadTasks' | 'torrents'>,
  caller: StoreCaller,
  query: { limit?: string; offset?: string },
): Promise<{ items: TorzListItem[]; total_items: number }> {
  const limit = boundedInt(query.limit, STREMTHRU_LIST_DEFAULT_LIMIT, 1, STREMTHRU_LIST_MAX_LIMIT)
  const offset = boundedInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const { items, total } = await deps.downloadTasks.listByCreator({
    orgId: caller.orgId,
    userId: caller.userId,
    sourceTypes: TORRENT_SOURCE_TYPES,
    limit,
    offset,
  })
  const torrents = await deps.torrents.listByInfoHashes(items.flatMap((task) => (task.infoHash ? [task.infoHash] : [])))
  const byHash = new Map(torrents.map((torrent) => [torrent.infoHash, torrent]))
  return {
    items: items.map((task) => {
      const torrent = task.infoHash ? byHash.get(task.infoHash) : undefined
      const hash = torrent?.infoHash ?? task.infoHash ?? ''
      return {
        id: task.id,
        hash,
        name: torrent?.name ?? task.displayName ?? hash,
        size: torrent?.totalSize ?? 0,
        status: torzStatus(task.status),
        private: torrent?.private ?? false,
        added_at: task.createdAt.toISOString(),
      }
    }),
    total_items: total,
  }
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new StremThruError('BAD_REQUEST', `Expected an integer between ${min} and ${max}`)
  }
  return parsed
}

export async function getTorz(deps: Pick<Deps, 'downloadTasks' | 'torrents'>, caller: StoreCaller, id: string) {
  return toTorz(deps, await callerTask(deps, caller, id))
}

// Removes a torz: its files move to the workspace trash, so a removal the user
// did not make by hand stays recoverable, and the task leaves the list. The
// cached torrent stays; only eviction deletes it.
export async function removeTorz(deps: Deps, caller: StoreCaller, id: string): Promise<{ id: string }> {
  const task = await callerTask(deps, caller, id)
  if (!TERMINAL_STATUSES.includes(task.status)) {
    await withStoreErrors(() => performDownloadTaskAction(deps, caller.orgId, id, 'cancel'))
  }
  const torrent = await torrentOf(deps, task)
  if (torrent) await trashHeldFiles(deps, task, torrent)
  const current = await deps.downloadTasks.getRecord(caller.orgId, id)
  if (TERMINAL_STATUSES.includes(current.status)) {
    await withStoreErrors(() => performDownloadTaskAction(deps, caller.orgId, id, 'delete'))
  }
  return { id }
}

// Trashes the task's files. A torrent folder holding nothing but this torrent's
// files is trashed as a whole, so restoring it brings the tree back; files
// elsewhere are trashed one by one.
async function trashHeldFiles(deps: Deps, task: DownloadTaskRecord, torrent: TorrentRecord): Promise<void> {
  const held = [...(await heldFiles(deps, task, torrent)).values()]
  if (held.length === 0) return
  const files = await deps.torrents.listFiles(torrent.id)
  const loose: Matter[] = []
  const byRoot = new Map<string, Matter[]>()
  const target = normalizePath(task.targetFolder)
  if (torrentTreeRoot(torrent, files)) {
    for (const matter of held) {
      const relative = normalizePath(matter.parent).slice(target ? target.length + 1 : 0)
      const top = relative.split('/')[0]
      if (!top) {
        loose.push(matter)
        continue
      }
      byRoot.set(top, [...(byRoot.get(top) ?? []), matter])
    }
  } else {
    loose.push(...held)
  }
  for (const [top, matters] of byRoot) {
    const folder = await rootFolder(deps, task.orgId, target, top)
    if (folder && (await holdsOnlyTorrentFiles(deps, task.orgId, joinPath(target, top), torrent.infoHash))) {
      await deps.matter.trash(task.orgId, folder.id)
      continue
    }
    loose.push(...matters)
  }
  for (const matter of loose) await deps.matter.trash(task.orgId, matter.id)
}

function normalizePath(path: string): string {
  return path.split('/').filter(Boolean).join('/')
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

// The folder at `parent/name`, which holds files and so exists.
async function rootFolder(deps: Deps, orgId: string, parent: string, name: string): Promise<Matter | undefined> {
  const { items } = await deps.matter.list(orgId, { parent, name, pageSize: 1 })
  return items[0]
}

async function holdsOnlyTorrentFiles(deps: Deps, orgId: string, path: string, infoHash: string): Promise<boolean> {
  const prefix = `${TORRENT_CACHE_PREFIX}${infoHash}/`
  const children = await deps.matter.list(orgId, { parent: path, pageSize: TREE_PAGE_SIZE })
  if (children.nextBoundary) return false
  const nested = await deps.matter.listActiveDescendants(orgId, path)
  return [...children.items, ...nested].every((item) => item.dirtype !== DirType.FILE || item.object.startsWith(prefix))
}

// ─── Playback links (§10) ────────────────────────────────────────────────────

export interface GenerateLinkParams {
  caller: StoreCaller
  link: string | undefined
  cloudBaseUrl: string
  now?: Date
}

// Resolves an opaque file link to the caller's drive file and returns a
// presigned URL valid for 12 hours. The file's size is charged when a link is
// issued; while the issued link has more than an hour left it is returned again
// without another charge, because players reconnect and addons regenerate links.
export async function generateTorzLink(deps: Deps, params: GenerateLinkParams): Promise<{ link: string }> {
  const { caller } = params
  const now = params.now ?? new Date()
  const matterId = params.link ? decodeFileLink(params.link) : null
  if (!matterId) throw new StremThruError('BAD_REQUEST', 'Invalid file link')
  const matter = await deps.matter.get(matterId, caller.orgId)
  if (
    !matter ||
    matter.dirtype !== DirType.FILE ||
    matter.status !== 'active' ||
    matter.trashedAt != null ||
    matter.purgedAt != null ||
    !isTorrentCacheKey(matter.object)
  ) {
    throw new StremThruError('NOT_FOUND', 'File not found')
  }
  await touchTorrent(deps, matter.object, now)

  const issued = await deps.stremthruLinks.get(caller.userId, matter.id)
  if (issued && issued.expiresAt.getTime() - now.getTime() > STREMTHRU_LINK_REUSE_MIN_REMAINING_MS) {
    return { link: issued.url }
  }

  const storage = await deps.storages.get(matter.storageId)
  if (!storage) throw new StremThruError('NOT_FOUND', 'File not found')
  const bytes = matter.size ?? 0
  const trafficEventId = createTrafficEventId()
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: caller.orgId,
    bytes,
    storage,
    source: 'object_download',
    sourceId: matter.id,
    eventId: trafficEventId,
  })
  if (!metered.ok) {
    throw new StremThruError(
      'PAYMENT_REQUIRED',
      metered.reason === 'quota_exceeded' ? 'Traffic quota exceeded' : 'Insufficient credits',
    )
  }

  let url: string
  try {
    url = await deps.s3.presignDownload(storage, matter.object, matter.name, STREMTHRU_LINK_TTL_SECONDS)
    await confirmDownloadTraffic(deps, { eventId: trafficEventId, now })
  } catch (error) {
    await reverseDownloadTraffic(deps, { orgId: caller.orgId, bytes, eventId: trafficEventId, now })
    throw error
  }
  await deps.stremthruLinks.save({
    userId: caller.userId,
    orgId: caller.orgId,
    matterId: matter.id,
    url,
    expiresAt: new Date(now.getTime() + STREMTHRU_LINK_TTL_SECONDS * 1000),
    now,
  })
  await recordDownloadIssued(
    deps,
    { userId: caller.userId, actorType: 'api_key', actorRef: caller.keyId },
    'object_download',
    {
      orgId: caller.orgId,
      targetType: 'file',
      targetId: matter.id,
      targetName: matter.name,
      bytes,
      source: 'stremthru',
      metadata: { storageId: storage.id },
    },
    trafficEventId,
  )
  return { link: url }
}

async function touchTorrent(deps: Pick<Deps, 'torrents'>, object: string, now: Date): Promise<void> {
  const infoHash = object.slice(TORRENT_CACHE_PREFIX.length).split('/')[0]
  const torrent = infoHash ? await deps.torrents.getByInfoHash(infoHash) : null
  if (torrent) await deps.torrents.touch(torrent.id, ['ready', 'verifying'], now)
}

// ─── Errors ──────────────────────────────────────────────────────────────────

const APP_ERROR_CODES: Record<number, StremThruErrorCode> = {
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'PAYMENT_REQUIRED',
  429: 'TOO_MANY_REQUESTS',
}

// Maps ZPan errors from the download usecases onto StremThru's codes.
async function withStoreErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw toStremThruError(error)
  }
}

export function toStremThruError(error: unknown): Error {
  if (error instanceof StremThruError) return error
  if (error instanceof DownloadError) {
    if (error.code === 'not_found') return new StremThruError('NOT_FOUND', 'Torz not found')
    if (error.code === 'forbidden') return new StremThruError('FORBIDDEN', error.message)
    return new StremThruError('BAD_REQUEST', error.message)
  }
  if (error instanceof AppError) {
    const code = APP_ERROR_CODES[error.httpStatus] ?? (error.httpStatus < 500 ? 'BAD_REQUEST' : null)
    if (code) return new StremThruError(code, error.message)
  }
  return error instanceof Error ? error : new Error(String(error))
}
