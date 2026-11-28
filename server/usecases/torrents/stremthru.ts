// The StremThru Store API over Torrents lists (docs/design/torrents.md §8, §10,
// §12). A `stremthru` API key names one user in one workspace; addons check which
// infoHashes are cached, add torrents to the workspace's Torrents list, list and
// remove its entries, and generate playback links. An add writes no drive files:
// a ready torrent lands in the list at once, one downloading waits for that
// download, and otherwise a list-only download fills it. Removing an entry never
// deletes bytes; only eviction does.

import { ApiKeyTemplate } from '@shared/api-key-templates'
import { hasFeature } from '../../domain/licensing'
import {
  decodeFileLink,
  encodeFileLink,
  magnetFor,
  parseCheckHash,
  STREMTHRU_CHECK_MAX_HASHES,
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
import { parseMagnetDisplayName } from '../../domain/torrent-info'
import type { Database } from '../../platform/interface'
import type { Deps } from '../deps'
import { createDownloadTask } from '../downloads/downloads'
import {
  type ApiKeyAuth,
  ApiKeyRateLimitError,
  AppError,
  DownloadError,
  type TorrentFileRecord,
  type WorkspaceTorrentRecord,
} from '../ports'
import { loadBindingState } from '../site/licensing'
import { TORRENT_INVALID_MESSAGE } from './entries'
import { fillerActive } from './fill'
import {
  getWorkspaceTorrent,
  issueTorrentFileLink,
  listWorkspaceTorrentsByOffset,
  removeWorkspaceTorrent,
  type WorkspaceTorrentItem,
} from './workspace-list'

const WRITE_ROLES = ['owner', 'admin', 'editor']

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
// to the workspace is FORBIDDEN; an instance without the torrents
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
  if (!hasFeature('torrents', await loadBindingState(deps))) {
    throw new StremThruError('PAYMENT_REQUIRED', 'Torrents need a Pro or Business license')
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

// ─── Torz items (the workspace's Torrents list) ──────────────────────────────

function listItem({ view, state }: WorkspaceTorrentItem): TorzListItem {
  const hash = view.torrent?.infoHash ?? view.infoHash ?? ''
  return {
    id: view.id,
    hash,
    name: view.torrent?.name ?? view.displayName ?? hash,
    size: view.torrent?.totalSize ?? 0,
    status: torzStatus(state.status),
    private: view.torrent?.private ?? false,
    added_at: view.createdAt.toISOString(),
  }
}

function magnetOf(view: WorkspaceTorrentRecord, hash: string): string {
  if (/^magnet:\?/i.test(view.sourceUri)) return view.sourceUri
  return hash ? magnetFor(hash) : ''
}

async function toTorz(deps: Deps, caller: StoreCaller, id: string): Promise<Torz> {
  const detail = await getWorkspaceTorrent(deps, caller.orgId, id).catch((error) => {
    throw toStremThruError(error)
  })
  const item = listItem(detail)
  // Files carry links once they play, and a playable entry is `downloaded`:
  // addons wait for that status before they generate a link. That includes a
  // torrent still verifying for the workspace that filled it, and one that
  // streams while it downloads (docs/design/torrents.md §14); `check` still
  // reports both uncached.
  const playable = detail.playable || detail.streamable
  const files = playable ? detail.files.map((file) => torzFile(file, encodeFileLink(detail.view.id, file.id))) : []
  const status = playable ? 'downloaded' : item.status
  return { ...item, status, magnet: magnetOf(detail.view, item.hash), files }
}

// Adds a magnet or .torrent link to the workspace's Torrents list. An entry the
// workspace already has is returned as it is, unless it failed, when it is
// added anew, or its download ran out of credits, which is PAYMENT_REQUIRED. One
// paused by hand is returned as it is: an addon does not undo a pause.
export async function addTorz(deps: Deps, caller: StoreCaller, link: string | undefined): Promise<Torz> {
  const source = link ? torzSource(link) : null
  if (!source) throw new StremThruError('BAD_REQUEST', 'A magnet link or torrent URL is required')
  const infoHash = source.type === 'magnet' ? parseCheckHash(source.uri) : null
  // A torrent URL the workspace added before is matched by the link, resolved
  // or not, because addons add the same links again and again. One whose entry
  // merged into another is matched by the infoHash its task learned.
  const knownHash = infoHash ?? (await deps.downloadTasks.findInfoHashBySourceUri(caller.orgId, source.uri)) ?? null
  const existing =
    (source.type === 'torrent_url' ? await deps.workspaceTorrents.findBySourceUri(caller.orgId, source.uri) : null) ??
    (knownHash ? await deps.workspaceTorrents.findByInfoHash(caller.orgId, knownHash) : null)
  if (existing) {
    const detail = await getWorkspaceTorrent(deps, caller.orgId, existing.id)
    // Addons show their "need premium" notice for this, instead of a transfer error.
    if (detail.state.pauseReason === 'insufficient_credits') {
      throw new StremThruError('PAYMENT_REQUIRED', 'Insufficient remote-download credits')
    }
    if (detail.state.status !== 'failed') return toTorz(deps, caller, existing.id)
  }
  const id = await withStoreErrors(() => placeEntry(deps, caller, source, existing?.infoHash ?? knownHash, existing))
  return toTorz(deps, caller, id)
}

// Steps 1–3 of docs/design/torrents.md §4 for a StremThru add: a ready torrent
// lands in the list at once, one in progress makes the entry wait for it, and
// otherwise a list-only task in the workspace downloads it.
async function placeEntry(
  deps: Deps,
  caller: StoreCaller,
  source: { type: 'magnet' | 'torrent_url'; uri: string },
  infoHash: string | null,
  existing: WorkspaceTorrentRecord | null,
): Promise<string> {
  const now = new Date()
  const found = infoHash ? await deps.torrents.getByInfoHash(infoHash) : null
  // A ready torrent is accessed now, before the entry holds it, so a capacity
  // sweep that ranked it meanwhile loses its claim; one already claimed is
  // treated as gone.
  const touched = found?.status === 'ready' ? await deps.torrents.touch(found.id, ['ready'], now) : true
  const torrent = found && found.status !== 'evicting' && touched ? found : null
  const waits =
    !!torrent &&
    (torrent.status === 'ready' ||
      torrent.status === 'verifying' ||
      torrent.status === 'invalid' ||
      (torrent.status === 'downloading' && (await fillerActive(deps, torrent))))
  const status = torrent?.status === 'invalid' ? 'failed' : 'active'
  const error = torrent?.status === 'invalid' ? TORRENT_INVALID_MESSAGE : null

  let entryId: string
  if (existing) {
    entryId = existing.id
    await deps.workspaceTorrents.update(existing.id, {
      torrentId: torrent?.id ?? existing.torrentId,
      status,
      error,
      taskId: null,
      updatedAt: now,
    })
  } else {
    const { created, entry } = await deps.workspaceTorrents.insert({
      orgId: caller.orgId,
      torrentId: torrent?.id ?? null,
      infoHash,
      source: 'stremthru',
      sourceUri: source.uri,
      displayName: source.type === 'magnet' ? parseMagnetDisplayName(source.uri) : null,
      taskId: null,
      status,
      error,
      createdBy: { type: 'api_key', ref: caller.keyId, issuer: null },
      now,
    })
    // A concurrent add of the same torrent placed it already.
    if (!created) return entry.id
    entryId = entry.id
  }
  if (waits) return entryId

  try {
    await createDownloadTask(
      deps,
      caller.orgId,
      caller.userId,
      { source, targetFolder: '' },
      { type: 'api_key', ref: caller.keyId, issuer: null },
      { listEntryId: entryId },
    )
  } catch (error) {
    if (!existing) await deps.workspaceTorrents.delete(entryId)
    throw error
  }
  return entryId
}

export async function listTorz(
  deps: Deps,
  caller: StoreCaller,
  query: { limit?: string; offset?: string },
): Promise<{ items: TorzListItem[]; total_items: number }> {
  const limit = boundedInt(query.limit, STREMTHRU_LIST_DEFAULT_LIMIT, 1, STREMTHRU_LIST_MAX_LIMIT)
  const offset = boundedInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const { items, total } = await listWorkspaceTorrentsByOffset(deps, caller.orgId, { limit, offset })
  return { items: items.map(listItem), total_items: total }
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new StremThruError('BAD_REQUEST', `Expected an integer between ${min} and ${max}`)
  }
  return parsed
}

export async function getTorz(deps: Deps, caller: StoreCaller, id: string): Promise<Torz> {
  return toTorz(deps, caller, id)
}

// Removes the entry from the workspace's Torrents list.
export async function removeTorz(deps: Deps, caller: StoreCaller, id: string): Promise<{ id: string }> {
  await withStoreErrors(() => removeWorkspaceTorrent(deps, caller.orgId, id))
  return { id }
}

// ─── Playback links (§10) ────────────────────────────────────────────────────

export interface GenerateLinkParams {
  caller: StoreCaller
  link: string | undefined
  cloudBaseUrl: string
  // Builds the stream link of a torrent that streams while it downloads.
  streamUrl?: (torrentFileId: string, expiresAt: Date) => Promise<string>
  now?: Date
}

// Resolves an opaque file link within the caller's Torrents list and returns a
// presigned URL valid for 12 hours, or a stream link for a torrent that streams
// while it downloads.
export async function generateTorzLink(deps: Deps, params: GenerateLinkParams): Promise<{ link: string }> {
  const { caller } = params
  const ref = params.link ? decodeFileLink(params.link) : null
  if (!ref) throw new StremThruError('BAD_REQUEST', 'Invalid file link')
  const issued = await withStoreErrors(() =>
    issueTorrentFileLink(deps, {
      orgId: caller.orgId,
      userId: caller.userId,
      actor: { actorType: 'api_key', actorRef: caller.keyId },
      entryId: ref.entryId,
      fileId: ref.fileId,
      cloudBaseUrl: params.cloudBaseUrl,
      source: 'stremthru',
      streamUrl: params.streamUrl,
      now: params.now,
    }),
  )
  if ('error' in issued) {
    throw new StremThruError(
      'PAYMENT_REQUIRED',
      issued.error.message === 'Traffic quota exceeded' ? 'Traffic quota exceeded' : 'Insufficient credits',
    )
  }
  return { link: issued.url }
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
