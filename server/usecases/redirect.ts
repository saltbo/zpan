// The redirect resource usecase. Owns every business decision behind the
// /r/:token short-link download routes — the two sub-resources served there:
// `ds_` direct shares and `ih_` image-hosting links. Each resolves a token,
// runs its access/expiry/limit gates, meters the download (egress quota + cloud
// report, with refund-on-presign-failure rollback), and presigns the object.
//
// The http handler only dispatches on the token prefix, extracts request-bound
// inputs (cloud base URL, referer header, request origin), and renders the
// route-specific Responses from the discriminated outcomes below.

import type { ImageHostingRepo, QuotaRepo, S3Gateway, ShareRepo, StorageRepo } from './ports'
import { PRESIGN_TTL_SECS } from './share'
import {
  type CloudTrafficMeteringDeps,
  meterDownloadTraffic,
  reportDownloadEgress,
} from './store/cloud-traffic-metering'

// The metering usecases need the cloud-report ports plus quota; the redirect
// flows additionally read shares / image-hosting / storages and presign via s3.
export type RedirectDeps = CloudTrafficMeteringDeps & {
  quota: QuotaRepo
  s3: S3Gateway
  storages: StorageRepo
  share: ShareRepo
  imageHosting: ImageHostingRepo
}

// ─── Direct share (ds_) ──────────────────────────────────────────────────────

export type DirectShareOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: 'matter_trashed' }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'limit_exceeded' }
  | { ok: false; reason: 'storage_not_found' }
  | { ok: false; reason: 'quota_exceeded' }
  | { ok: false; reason: 'insufficient_credits' }

// Resolve a ds_ token to a presigned download URL, running the share gates,
// atomically reserving a download, metering traffic, and presigning. On a
// presign failure the traffic and the reserved download are both rolled back
// before the error propagates (→ 500 at the http layer).
export async function resolveDirectShareDownload(
  deps: RedirectDeps,
  params: { token: string; cloudBaseUrl: string; now?: Date },
): Promise<DirectShareOutcome> {
  const now = params.now ?? new Date()
  const resolved = await deps.share.resolveByToken(params.token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return { ok: false, reason: 'matter_trashed' }
    return { ok: false, reason: 'not_found' }
  }

  const { share, matter } = resolved
  if (share.kind !== 'direct') return { ok: false, reason: 'not_found' }

  if (share.expiresAt && share.expiresAt < now) return { ok: false, reason: 'expired' }

  if (!(await deps.share.hasDownloadsAvailable(share.id))) return { ok: false, reason: 'limit_exceeded' }

  const storage = await deps.storages.get(matter.storageId)
  if (!storage) return { ok: false, reason: 'storage_not_found' }

  const { ok } = await deps.share.incrementDownloadsAtomic(share.id)
  if (!ok) return { ok: false, reason: 'limit_exceeded' }

  const bytes = matter.size ?? 0
  const metered = await meterDownloadTraffic(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: share.orgId,
    bytes,
    storage,
    source: 'direct_share',
    sourceId: share.id,
    onRejected: () => deps.share.decrementDownloads(share.id),
  })
  if (!metered.ok) return { ok: false, reason: metered.reason }

  let url: string
  try {
    url = await deps.s3.presignDownload(storage, matter.object, matter.name, PRESIGN_TTL_SECS)
  } catch (e) {
    await deps.quota.refundTraffic(share.orgId, bytes)
    await deps.share.decrementDownloads(share.id)
    throw e
  }

  return { ok: true, url }
}

// ─── Image hosting (ih_) ─────────────────────────────────────────────────────

export type ImageHostingOutcome =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'forbidden_referer' }
  | { ok: false; reason: 'storage_not_found' }
  | { ok: false; reason: 'quota_exceeded' }
  | { ok: false; reason: 'insufficient_credits' }

// Resolve an ih_ token to a presigned inline URL. Order matters and mirrors the
// historical flow: enforce the referer allowlist, consume traffic quota, presign
// (refunding the quota on failure → 500), THEN report egress to Cloud (refunding
// + 402 on a credit block, so the presigned URL is discarded) and only then bump
// the access count. The access count is therefore never incremented on any of
// the rejection paths.
export async function resolveImageHostingDownload(
  deps: RedirectDeps,
  params: { token: string; cloudBaseUrl: string; refererHeader: string | null; requestOrigin: string },
): Promise<ImageHostingOutcome> {
  const resolved = await deps.imageHosting.resolveActiveByToken(params.token)
  if (!resolved) return { ok: false, reason: 'not_found' }

  const { image, refererAllowlist } = resolved

  // Allow same-origin requests (e.g. Web UI viewing its own images).
  const isSameOrigin = params.refererHeader ? new URL(params.refererHeader).origin === params.requestOrigin : false
  if (!isSameOrigin && !checkReferer(refererAllowlist, params.refererHeader)) {
    return { ok: false, reason: 'forbidden_referer' }
  }

  const storage = await deps.storages.get(image.storageId)
  if (!storage) return { ok: false, reason: 'storage_not_found' }

  const trafficAllowed = await deps.quota.consumeTrafficIfQuotaAllows(image.orgId, image.size)
  if (!trafficAllowed) return { ok: false, reason: 'quota_exceeded' }

  let url: string
  try {
    url = await deps.s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)
  } catch (e) {
    await deps.quota.refundTraffic(image.orgId, image.size)
    throw e
  }

  const reported = await reportDownloadEgress(deps, {
    cloudBaseUrl: params.cloudBaseUrl,
    orgId: image.orgId,
    bytes: image.size,
    storage,
    source: 'image_hosting',
    sourceId: image.id,
  })
  // reportDownloadEgress never consumes quota, so it cannot return quota_exceeded.
  if (!reported.ok) return { ok: false, reason: 'insufficient_credits' }

  try {
    await deps.imageHosting.incrementAccessCount(image.id)
  } catch (error) {
    console.error('[redirect] incrementAccessCount failed:', error)
  }

  return { ok: true, url }
}

// ─── Referer allowlist (pure) ────────────────────────────────────────────────

function checkReferer(refererAllowlist: string[], refererHeader: string | null): boolean {
  if (refererAllowlist.length === 0) return true
  // Allow empty referer — direct access from tools, address bar, or privacy
  // extensions should not be blocked. The allowlist targets hotlinking from
  // unauthorized *websites*, which always send a Referer header.
  if (!refererHeader) return true
  try {
    const origin = new URL(refererHeader).origin
    return refererAllowlist.includes(origin)
  } catch {
    return false
  }
}
