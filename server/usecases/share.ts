// The shares resource usecase. Owns every business decision behind the public
// (/api/shares before auth) and authed (/api/shares after auth) share routes:
// resolution gating, view/download dedup, the end-to-end download meter, share
// creation + recipient notification, revocation, and save-to-drive. The http
// handlers only read cookies/params, call these functions with `deps` whole,
// and serialize the discriminated outcomes into responses.
//
// Cookies stay in http: the usecase takes cookie-derived inputs (viewerId,
// whether the access cookie is 'ok', whether the view cookie was already 'seen')
// and returns cookie *decisions*; the handler runs getCookie/setCookie.

import { createHmac } from 'node:crypto'
import { DirType } from '@shared/constants'
import type { CreateShareRequest, ShareObjectsResponse } from '@shared/schemas/share'
import { isAccessibleByUser } from '../domain/share'
import { verifyPassword as verifyPasswordHash } from '../lib/password'
import type { Platform } from '../platform/interface'
import { type SaveToDriveDeps, saveShareToDrive } from './object'
import {
  AppError,
  badRequest,
  CreateShareError,
  type EmailGateway,
  expired as expiredError,
  forbidden,
  insufficientCredits,
  type Matter,
  type MatterRepo,
  type NotificationRepo,
  notFound,
  type OrgRepo,
  passwordRequired,
  type QuotaRepo,
  quotaExceeded,
  type S3Gateway,
  type ShareNotificationRecipient,
  type ShareNotificationRepo,
  type ShareNotificationShare,
  type ShareRecipientRecord,
  type ShareRecord,
  type ShareRepo,
  type StorageRepo,
  storageNotFound,
} from './ports'
import type { CloudTrafficMeteringDeps } from './store/traffic-metering'
import { confirmDownloadTraffic, meterDownloadTraffic, reverseDownloadTraffic } from './store/traffic-metering'
import { createTrafficEventId } from './transfer-activity'

// The ports + sub-usecase deps this resource touches. `c.get('deps')` (the full
// Deps) structurally satisfies this, so the handler passes it whole. The
// intersected sub-usecase deps (save-to-drive, share-notification, the download
// meter) carry the ports those collaborators reach through.
export type ShareDeps = SaveToDriveDeps &
  ShareNotificationDeps &
  CloudTrafficMeteringDeps & {
    share: ShareRepo
    matter: MatterRepo
    storages: StorageRepo
    s3: S3Gateway
    quota: QuotaRepo
    org: OrgRepo
  }

// ─── GET /:token — view a share (creator vs viewer DTO) ──────────────────────

export type ViewShareParams = {
  token: string
  viewerId: string | null
  // Cookie-derived: 'seen' if the view-dedup cookie is already set.
  viewCookie: string | undefined
  // Cookie-derived: 'ok' if the access cookie is set.
  accessCookie: string | undefined
  now?: Date
}

export type ShareViewerDto = {
  token: string
  kind: string
  status: string
  expiresAt: Date | null
  downloadLimit: number | null
  matter: { name: string; type: string; size: number | null; isFolder: boolean }
  creatorName: string
  creatorUsername: string | null
  requiresPassword: boolean
  expired: boolean
  exhausted: boolean
  accessibleByUser: boolean
  downloads: number
  views: number
  rootRef: string
}

export type ShareCreatorDto = ShareViewerDto & {
  id: string
  matterId: string
  orgId: string
  creatorId: string
  createdAt: Date
  recipients: ShareRecipientRecord[]
}

export type ViewShareOutcome =
  | { ok: true; dto: ShareViewerDto | ShareCreatorDto; setViewCookie: boolean }
  | { ok: false; error: AppError }

// Assemble the share view DTO from resolved share data. The creator (matched by
// viewerId) gets the richer ShareCreatorDto; everyone else gets the viewer DTO.
// Shared by viewShare and revokeShare so both expose an identically-shaped view.
async function composeShareView(
  deps: ShareDeps,
  resolved: { share: ShareRecord; matter: Matter; recipients: ShareRecipientRecord[] },
  opts: { viewerId: string | null; accessCookie: string | undefined; now: Date },
): Promise<ShareViewerDto | ShareCreatorDto> {
  const { share, matter, recipients } = resolved
  const { viewerId, accessCookie, now } = opts
  const isCreator = !!viewerId && viewerId === share.creatorId

  const accessibleByUser = viewerId ? isAccessibleByUser(recipients, viewerId) : false
  const requiresPassword = !isCreator && !!(share.passwordHash && !accessibleByUser && accessCookie !== 'ok')
  const expired = !!(share.expiresAt && share.expiresAt < now)
  const exhausted = !!(share.downloadLimit != null && share.downloads >= share.downloadLimit)
  const isFolder = matter.dirtype !== DirType.FILE

  const creator = await deps.share.getCreatorIdentity(share.creatorId)

  const base: ShareViewerDto = {
    token: share.token,
    kind: share.kind,
    status: share.status,
    expiresAt: share.expiresAt,
    downloadLimit: share.downloadLimit,
    matter: { name: matter.name, type: matter.type, size: matter.size, isFolder },
    creatorName: creator?.name ?? '',
    creatorUsername: creator?.username ?? null,
    requiresPassword,
    expired,
    exhausted,
    accessibleByUser,
    downloads: share.downloads,
    views: share.views,
    rootRef: encodeChildRef(share.token, matter.id),
  }

  if (isCreator) {
    return {
      ...base,
      id: share.id,
      matterId: share.matterId,
      orgId: share.orgId,
      creatorId: share.creatorId,
      createdAt: share.createdAt,
      recipients,
    }
  }
  return base
}

export async function viewShare(deps: ShareDeps, params: ViewShareParams): Promise<ViewShareOutcome> {
  const { token, viewerId, viewCookie, accessCookie, now = new Date() } = params

  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return { ok: false, error: expiredError('File no longer available') }
    return { ok: false, error: notFound('Share not found or revoked') }
  }

  const { share, matter, recipients } = resolved
  const isCreator = !!viewerId && viewerId === share.creatorId

  // Direct shares are not publicly viewable; only the creator sees metadata.
  if (share.kind !== 'landing' && !isCreator) return { ok: false, error: notFound('Share not found or revoked') }

  // View-dedup increment: non-creators whose view cookie isn't yet 'seen'. The
  // handler sets the cookie when setViewCookie is true.
  const setViewCookie = !isCreator && viewCookie !== 'seen'
  if (setViewCookie) {
    await deps.share.incrementViews(share.id)
  }

  const dto = await composeShareView(deps, { share, matter, recipients }, { viewerId, accessCookie, now })
  return { ok: true, setViewCookie, dto }
}

// ─── POST /:token/sessions — verify password → access-cookie decision ────────

export type VerifySharePasswordParams = { token: string; password: string; viewerId?: string | null; now?: Date }

export type VerifySharePasswordOutcome = { ok: true; setAccessCookieExpiry: Date } | { ok: false; error: AppError }

export async function verifySharePassword(
  deps: ShareDeps,
  params: VerifySharePasswordParams,
): Promise<VerifySharePasswordOutcome> {
  const { token, password, now = new Date() } = params

  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status !== 'ok') return { ok: false, error: notFound('Share not found or revoked') }

  const { share } = resolved
  if (share.kind !== 'landing') return { ok: false, error: notFound('Share not found or revoked') }

  if (!share.passwordHash || !verifyPasswordHash(share.passwordHash, password))
    return { ok: false, error: forbidden('Invalid password') }

  // Cookie lives for up to a day, never past the share's own expiry.
  const oneDayMs = 24 * 60 * 60 * 1000
  const setAccessCookieExpiry = share.expiresAt
    ? new Date(Math.min(share.expiresAt.getTime(), now.getTime() + oneDayMs))
    : new Date(now.getTime() + oneDayMs)

  return { ok: true, setAccessCookieExpiry }
}

// ─── GET /:token/objects — folder listing ────────────────────────────────────

export type ListShareObjectsParams = {
  token: string
  viewerId: string | null
  accessCookie: string | undefined
  relativePath: string
  page: number
  pageSize: number
  now?: Date
}

export type ListShareObjectsResult = ShareObjectsResponse

export type ListShareObjectsOutcome = { ok: true; result: ListShareObjectsResult } | { ok: false; error: AppError }

export async function listShareObjects(
  deps: ShareDeps,
  params: ListShareObjectsParams,
): Promise<ListShareObjectsOutcome> {
  const { token, viewerId, accessCookie, relativePath, page, pageSize, now = new Date() } = params

  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return { ok: false, error: expiredError('File no longer available') }
    return { ok: false, error: notFound('Share not found or revoked') }
  }

  const { share, matter, recipients } = resolved
  if (share.kind !== 'landing') return { ok: false, error: notFound('Share not found or revoked') }
  if (matter.dirtype === DirType.FILE) return { ok: false, error: badRequest('Not a folder share') }

  if (checkAccessGate(share.passwordHash, recipients, viewerId, accessCookie) === 'password_required')
    return { ok: false, error: passwordRequired() }

  if (share.expiresAt && share.expiresAt < now) return { ok: false, error: expiredError('Share has expired') }

  if (relativePath.includes('..')) return { ok: false, error: badRequest('Invalid path') }

  const root = folderRootPath(matter)
  const queryParent = relativePath ? `${root}/${relativePath}` : root

  const result = await deps.matter.list(matter.orgId, { parent: queryParent, page, pageSize })

  return {
    ok: true,
    result: {
      items: result.items.map((m) => ({
        ref: encodeChildRef(token, m.id),
        name: m.name,
        type: m.type,
        size: m.size,
        isFolder: m.dirtype !== DirType.FILE,
      })),
      total: result.total,
      page,
      pageSize,
      breadcrumb: buildBreadcrumb(matter.name, relativePath),
    },
  }
}

// ─── GET /:token/readme — root README.md content ────────────────────────────

const MAX_SHARE_README_BYTES = 1024 * 1024

export type ReadShareReadmeParams = {
  token: string
  viewerId: string | null
  accessCookie: string | undefined
  now?: Date
}

export type ReadShareReadmeOutcome = { ok: true; content: string } | { ok: false; error: AppError }

export async function readShareReadme(deps: ShareDeps, params: ReadShareReadmeParams): Promise<ReadShareReadmeOutcome> {
  const { token, viewerId, accessCookie, now = new Date() } = params
  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status !== 'ok') return { ok: false, error: notFound('README.md not found') }

  const { share, matter, recipients } = resolved
  if (share.kind !== 'landing' || matter.dirtype === DirType.FILE)
    return { ok: false, error: notFound('README.md not found') }
  if (checkAccessGate(share.passwordHash, recipients, viewerId, accessCookie) === 'password_required')
    return { ok: false, error: passwordRequired() }
  if (share.expiresAt && share.expiresAt < now) return { ok: false, error: expiredError('Share has expired') }

  const children = await deps.share.listDirectActiveChildren(matter.orgId, folderRootPath(matter))
  const readme = children.find((child) => child.dirtype === DirType.FILE && child.name === 'README.md')
  if (!readme) return { ok: false, error: notFound('README.md not found') }
  if ((readme.size ?? 0) > MAX_SHARE_README_BYTES)
    return { ok: false, error: new AppError(413, 'README.md is too large') }

  const storage = await deps.storages.get(readme.storageId)
  if (!storage) return { ok: false, error: storageNotFound() }

  const bytes = await deps.s3.getObjectBytes(storage, readme.object)
  try {
    return { ok: true, content: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, error: badRequest('README.md must be UTF-8 text') }
  }
}

// ─── GET /:token/objects/:ref — download (orchestration + metering) ──────────

export type DownloadShareObjectParams = {
  token: string
  // The decoded matter id of the requested ref (null when the ref signature
  // failed to verify); the handler decodes/validates via the pure ref helpers.
  matterId: string | null
  viewerId: string | null
  accessCookie: string | undefined
  cloudBaseUrl: string
}

export type DownloadShareObjectOutcome =
  | {
      ok: true
      url: string
      receipt: {
        orgId: string
        creatorId: string
        shareId: string
        matterId: string
        matterName: string
        storageId: string
        bytes: number
        trafficEventId: string
      }
    }
  | { ok: false; error: AppError }

export async function downloadShareObject(
  deps: ShareDeps,
  params: DownloadShareObjectParams,
): Promise<DownloadShareObjectOutcome> {
  const { token, matterId, viewerId, accessCookie, cloudBaseUrl } = params

  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return { ok: false, error: expiredError('File no longer available') }
    return { ok: false, error: notFound('File not found or not accessible') }
  }

  const { share, matter, recipients } = resolved
  if (share.kind !== 'landing') return { ok: false, error: notFound('File not found or not accessible') }

  if (matterId === null) return { ok: false, error: badRequest('Invalid reference') }

  if (checkAccessGate(share.passwordHash, recipients, viewerId, accessCookie) === 'password_required')
    return { ok: false, error: passwordRequired() }

  if (share.expiresAt && share.expiresAt < new Date()) return { ok: false, error: expiredError('Share has expired') }

  let targetMatter = matter
  if (matterId !== matter.id) {
    if (matter.dirtype === DirType.FILE) return { ok: false, error: notFound('File not found or not accessible') }
    const child = await deps.share.findShareChildMatter(matter, matterId)
    if (!child) return { ok: false, error: notFound('File not found or not accessible') }
    targetMatter = child
  } else if (matter.dirtype !== DirType.FILE) {
    return { ok: false, error: badRequest('Cannot download a folder directly') }
  }

  if (!(await deps.share.hasDownloadsAvailable(share.id)))
    return { ok: false, error: expiredError('Download limit exceeded') }

  const storage = await deps.storages.get(targetMatter.storageId)
  if (!storage) return { ok: false, error: storageNotFound() }

  const { ok: incremented } = await deps.share.incrementDownloadsAtomic(share.id)
  if (!incremented) return { ok: false, error: expiredError('Download limit exceeded') }

  const bytes = targetMatter.size ?? 0
  const trafficEventId = createTrafficEventId()
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl,
    orgId: share.orgId,
    bytes,
    storage,
    source: 'landing_share',
    sourceId: share.id,
    eventId: trafficEventId,
    onRejected: () => deps.share.decrementDownloads(share.id),
  })
  if (!metered.ok) {
    return {
      ok: false,
      error:
        metered.reason === 'quota_exceeded'
          ? quotaExceeded('Traffic quota exceeded')
          : insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } }),
    }
  }

  // Presign. On failure the metering already succeeded, so roll it back
  // ourselves: refund the consumed traffic and the download count, then rethrow.
  let url: string
  try {
    url = await deps.s3.presignDownload(storage, targetMatter.object, targetMatter.name, PRESIGN_TTL_SECS)
  } catch (e) {
    try {
      await reverseDownloadTraffic(deps, { orgId: share.orgId, bytes, eventId: trafficEventId })
    } finally {
      await deps.share.decrementDownloads(share.id)
    }
    throw e
  }

  try {
    await confirmDownloadTraffic(deps, { eventId: trafficEventId })
  } catch (error) {
    try {
      await reverseDownloadTraffic(deps, { orgId: share.orgId, bytes, eventId: trafficEventId })
    } finally {
      await deps.share.decrementDownloads(share.id)
    }
    throw error
  }

  return {
    ok: true,
    url,
    receipt: {
      orgId: share.orgId,
      creatorId: share.creatorId,
      shareId: share.id,
      matterId: targetMatter.id,
      matterName: targetMatter.name,
      storageId: storage.id,
      bytes,
      trafficEventId,
    },
  }
}

// ─── GET / — list shares (received / sent) ───────────────────────────────────

export type ListSharesParams = {
  userId: string
  box: 'received' | 'sent' | undefined
  page: number
  pageSize: number
  status?: string
}

export async function listShares(deps: ShareDeps, params: ListSharesParams) {
  const { userId, box, page, pageSize, status } = params

  if (box === 'received') {
    const email = await deps.share.getUserEmail(userId)
    const result = await deps.share.listReceivedForApi(userId, email, { page, pageSize })
    return { ...result, page, pageSize }
  }

  const result = await deps.share.listForApi(userId, { page, pageSize, status })
  return { ...result, page, pageSize }
}

// ─── POST / — create a share (notify + activity; map create errors) ──────────

export type CreateShareParams = {
  orgId: string
  userId: string
  // The validated create-share request body. `expiresAt` is an ISO string here
  // (the wire shape); it is parsed to a Date before hitting the repo.
  input: CreateShareRequest
}

export type CreatedShare = {
  token: string
  kind: string
  expiresAt: Date | null
  downloadLimit: number | null
  private: boolean
}

export type CreateShareOutcome = { ok: true; share: CreatedShare } | { ok: false; error: AppError }

// The wire mapping for each CreateShareError code: a 404 (matter missing) or a
// 400 (invalid direct-share shape), each preserving its stable reason.
const CREATE_SHARE_ERRORS: Record<CreateShareError['code'], AppError> = {
  MATTER_NOT_FOUND: new AppError(404, 'Matter not found', { reason: 'MATTER_NOT_FOUND' }),
  DIRECT_NO_FOLDER: badRequest('Direct shares cannot be folders', 'DIRECT_NO_FOLDER'),
  DIRECT_NO_PASSWORD: badRequest('Direct shares cannot have a password', 'DIRECT_NO_PASSWORD'),
  DIRECT_NO_RECIPIENTS: badRequest('Direct shares cannot have recipients', 'DIRECT_NO_RECIPIENTS'),
}

export async function createShare(
  deps: ShareDeps,
  platform: Platform,
  params: CreateShareParams,
): Promise<CreateShareOutcome> {
  const { orgId, userId, input } = params

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : undefined

  const [creator, matterName] = await Promise.all([
    deps.share.getCreatorIdentity(userId),
    deps.share.getMatterName(input.matterId),
  ])
  const creatorName = creator?.name ?? 'Unknown'

  let share: ShareRecord
  try {
    share = await deps.share.create({
      matterId: input.matterId,
      orgId,
      creatorId: userId,
      kind: input.kind,
      password: input.password,
      expiresAt,
      downloadLimit: input.downloadLimit,
      recipients: input.recipients,
      private: input.private,
    })
  } catch (err) {
    if (err instanceof CreateShareError) return { ok: false, error: CREATE_SHARE_ERRORS[err.code] }
    throw err
  }

  const resolvedMatterName = matterName ?? ''

  const recipients = input.recipients ?? []
  if (recipients.length > 0) {
    dispatchShareCreated(
      deps,
      platform,
      { id: share.id, token: share.token, kind: share.kind as 'landing' | 'direct', expiresAt: share.expiresAt },
      recipients,
      creatorName,
      resolvedMatterName,
    ).catch((err) => console.error('[shares] dispatchShareCreated failed:', err))
  }

  return {
    ok: true,
    share: {
      token: share.token,
      kind: share.kind,
      expiresAt: share.expiresAt,
      downloadLimit: share.downloadLimit,
      private: share.private,
    },
  }
}

// ─── PUT /:token/privacy — owner-controlled profile visibility ──────────────

export type SetSharePrivacyParams = {
  token: string
  userId: string
  private: boolean
}

export type SetSharePrivacyOutcome = { ok: true; private: boolean } | { ok: false; error: AppError }

export async function setSharePrivacy(deps: ShareDeps, params: SetSharePrivacyParams): Promise<SetSharePrivacyOutcome> {
  const { token, userId, private: isPrivate } = params
  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status === 'not_found' || resolved.status === 'revoked') {
    return { ok: false, error: notFound() }
  }

  const { share, recipients } = resolved
  if (share.creatorId !== userId) return { ok: false, error: forbidden() }
  if (share.kind !== 'landing' || recipients.length > 0) {
    return {
      ok: false,
      error: badRequest('Only untargeted landing shares have configurable privacy', 'SHARE_PRIVACY_INELIGIBLE'),
    }
  }

  const updated = await deps.share.setPrivacy(token, userId, isPrivate)
  if (!updated) return { ok: false, error: notFound() }
  return { ok: true, private: isPrivate }
}

export function listPublicProfileShares(deps: ShareDeps, username: string, now = new Date()) {
  return deps.share.listPublicProfileShares(username, now)
}

// ─── PUT /:token/status — revoke (ownership-scoped) ──────────────────────────

export type RevokeShareParams = { token: string; userId: string; now?: Date }

export type RevokeShareOutcome = { ok: true; dto: ShareViewerDto | ShareCreatorDto } | { ok: false; error: AppError }

export async function revokeShare(deps: ShareDeps, params: RevokeShareParams): Promise<RevokeShareOutcome> {
  const { token, userId, now = new Date() } = params

  // Resolve before revoking: once the status flips to 'revoked', resolveByToken
  // no longer returns the record, so we capture the share here to build the
  // creator view. Unknown or already-revoked tokens are "not found" to the
  // revoker. A trashed matter still carries the records: the owner must be able
  // to revoke a share whose target was soft-deleted (trashing does not cascade
  // to shares), so this path stays revocable.
  const resolved = await deps.share.resolveByToken(token)
  if (resolved.status === 'not_found' || resolved.status === 'revoked') return { ok: false, error: notFound() }
  if (resolved.share.creatorId !== userId) return { ok: false, error: forbidden() }

  // Race-safe: revokeByToken scopes the UPDATE to (token, creatorId). An
  // ownership change between the resolve above and this call returns false —
  // translate to not_found at the boundary.
  const revoked = await deps.share.revokeByToken(token, userId)
  if (!revoked) return { ok: false, error: notFound() }

  // Return the creator view reflecting the post-revoke state.
  const dto = await composeShareView(
    deps,
    { share: { ...resolved.share, status: 'revoked' }, matter: resolved.matter, recipients: resolved.recipients },
    { viewerId: userId, accessCookie: undefined, now },
  )
  return { ok: true, dto }
}

// ─── POST /:token/objects — save-to-drive (gates + copy) ─────────────────────

export type SaveShareParams = {
  token: string
  currentUserId: string
  targetOrgId: string
  targetParent: string
  accessCookie: string | undefined
}

export type SaveShareOutcome =
  | { ok: true; result: { saved: Matter[]; skipped: Array<{ name: string; reason: string }> } }
  | { ok: false; error: AppError }

export async function saveShare(deps: ShareDeps, params: SaveShareParams): Promise<SaveShareOutcome> {
  const { token, currentUserId, targetOrgId, targetParent, accessCookie } = params

  const resolution = await deps.share.resolveByToken(token)
  if (resolution.status === 'matter_trashed') return { ok: false, error: expiredError('Share target has been deleted') }
  if (resolution.status !== 'ok') return { ok: false, error: notFound('Share not found') }

  const { share, matter, recipients } = resolution

  if (share.kind === 'direct')
    return {
      ok: false,
      error: badRequest(
        'Direct link shares cannot be saved. Ask the sender for a landing share.',
        'DIRECT_SAVE_FORBIDDEN',
      ),
    }

  if (checkAccessGate(share.passwordHash, recipients, currentUserId, accessCookie) === 'password_required')
    return { ok: false, error: passwordRequired('Authentication required for password-protected share') }

  if (!(await deps.org.canWriteToOrg(currentUserId, targetOrgId))) return { ok: false, error: forbidden() }

  const totalBytes = await deps.share.computeSourceBytes(matter)
  if (!(await deps.share.hasQuotaForBytes(targetOrgId, totalBytes))) return { ok: false, error: quotaExceeded() }

  const result = await saveShareToDrive(deps, { matter, currentUserId, targetOrgId, targetParent })
  return { ok: true, result }
}

// ── share notifications ──────────────────────────────────────────────────────

export type ShareNotificationDeps = {
  notifications: NotificationRepo
  email: EmailGateway
  shareNotifications: ShareNotificationRepo
}

async function sendShareEmail(
  deps: ShareNotificationDeps,
  platform: Platform,
  opts: { to: string; creatorName: string; matterName: string; url: string; expiresAt: Date | null },
): Promise<void> {
  const expiryLine = opts.expiresAt ? `<p>This share expires on ${opts.expiresAt.toISOString().split('T')[0]}.</p>` : ''
  await deps.email.send(platform, {
    to: opts.to,
    subject: `${opts.creatorName} shared "${opts.matterName}" with you`,
    html: `
      <h2>${opts.creatorName} shared a file with you</h2>
      <p><strong>${opts.matterName}</strong> is now available.</p>
      ${expiryLine}
      <p><a href="${opts.url}">Open share</a></p>
    `,
  })
}

export async function dispatchShareCreated(
  deps: ShareNotificationDeps,
  platform: Platform,
  share: ShareNotificationShare,
  recipients: ShareNotificationRecipient[],
  creatorName: string,
  matterName: string,
): Promise<void> {
  const shareUrl = share.kind === 'landing' ? `/s/${share.token}` : `/r/${share.token}`
  const emailEnabled = await deps.email.isConfigured(platform)

  for (const r of recipients) {
    if (r.recipientUserId) {
      await deps.notifications.create({
        userId: r.recipientUserId,
        type: 'share_received',
        title: `${creatorName} shared "${matterName}" with you`,
        body: 'Click to open the share',
        refType: 'share',
        refId: share.id,
        metadata: JSON.stringify({ token: share.token, kind: share.kind, creatorName, matterName }),
      })
    }

    const email =
      r.recipientEmail ?? (r.recipientUserId ? await deps.shareNotifications.getUserEmail(r.recipientUserId) : null)

    if (email && emailEnabled) {
      try {
        await sendShareEmail(deps, platform, {
          to: email,
          creatorName,
          matterName,
          url: shareUrl,
          expiresAt: share.expiresAt,
        })
      } catch (err) {
        console.error(`[share-notification] email to ${email} failed:`, err)
      }
    }
  }
}

// ── share refs ───────────────────────────────────────────────────────────────
// Pure share-token helpers shared by the share + redirect usecases and the http
// layer: child-ref signing/verification, folder path math, breadcrumb building,
// and the password/recipient access gate. Framework-free (node:crypto only), so
// usecases may import it; http/share-utils re-exports it for the handlers.

export const PRESIGN_TTL_SECS = 5 * 60

export function encodeChildRef(shareToken: string, matterId: string): string {
  const sig = createHmac('sha256', shareToken).update(matterId).digest('hex').slice(0, 16)
  return Buffer.from(`${matterId}.${sig}`).toString('base64url')
}

export function decodeChildRef(shareToken: string, childRef: string): string | null {
  try {
    const raw = Buffer.from(childRef, 'base64url').toString('utf-8')
    const dotIdx = raw.lastIndexOf('.')
    if (dotIdx < 0) return null
    const matterId = raw.slice(0, dotIdx)
    const sig = raw.slice(dotIdx + 1)
    const expectedSig = createHmac('sha256', shareToken).update(matterId).digest('hex').slice(0, 16)
    return sig === expectedSig ? matterId : null
  } catch {
    return null
  }
}

export function folderRootPath(matter: { parent: string; name: string }): string {
  return matter.parent ? `${matter.parent}/${matter.name}` : matter.name
}

export function buildBreadcrumb(rootName: string, relativePath: string): Array<{ name: string; path: string }> {
  const crumbs: Array<{ name: string; path: string }> = [{ name: rootName, path: '' }]
  if (!relativePath) return crumbs
  let accumulated = ''
  for (const part of relativePath.split('/')) {
    accumulated = accumulated ? `${accumulated}/${part}` : part
    crumbs.push({ name: part, path: accumulated })
  }
  return crumbs
}

export function checkAccessGate(
  passwordHash: string | null,
  recipients: ShareRecipientRecord[],
  userId: string | null,
  cookieValue: string | undefined,
): 'ok' | 'password_required' {
  if (!passwordHash) return 'ok'
  if (userId && isAccessibleByUser(recipients, userId)) return 'ok'
  if (cookieValue === 'ok') return 'ok'
  return 'password_required'
}
