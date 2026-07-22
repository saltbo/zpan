import type { Context, Next } from 'hono'
import { PRESIGN_TTL_SECS } from '../http/share-utils'
import { reportTrafficForDownload } from '../http/store/traffic-metering'
import type { Env } from '../middleware/platform'
import { forbidden, notFound, quotaExceeded, storageNotFound } from '../usecases/ports'
import { confirmDownloadTraffic, reverseDownloadTraffic } from '../usecases/store/traffic-metering'
import { createTrafficEventId } from '../usecases/transfer-activity'
import { recordDownloadFailure, recordDownloadIssued } from './audit-transfers'

function stripPort(host: string): string {
  const lastColon = host.lastIndexOf(':')
  if (lastColon < 0) return host
  const maybePort = host.slice(lastColon + 1)
  return /^\d+$/.test(maybePort) ? host.slice(0, lastColon) : host
}

function normalizeHost(raw: string): string | null {
  if (raw.includes('\0') || raw.includes('..')) return null
  return stripPort(raw.toLowerCase())
}

function getAppHostCandidates(c: Context<Env>): string[] {
  const candidates = ['workers.dev'] // *.workers.dev covers preview deployments
  const appHost = c.get('platform').getEnv('PUBLIC_APP_HOST')
  if (appHost) {
    const bare = appHost
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .toLowerCase()
    if (bare) candidates.push(bare)
  }
  return candidates
}

function checkReferer(refererAllowlist: string[], refererHeader: string | null): boolean {
  if (refererAllowlist.length === 0) return true
  if (!refererHeader) return false
  try {
    const origin = new URL(refererHeader).origin
    return refererAllowlist.includes(origin)
  } catch {
    return false
  }
}

async function handleImageByPath(c: Context<Env>, orgId: string, virtualPath: string): Promise<Response> {
  const resolved = await c.get('deps').imageHosting.resolveActiveByOrgPath(orgId, virtualPath)
  if (!resolved) throw notFound('Not found')

  const { image, refererAllowlist } = resolved

  const refererHeader = c.req.header('Referer') ?? null
  if (!checkReferer(refererAllowlist, refererHeader)) {
    throw forbidden('forbidden referer')
  }

  const storage = await c.get('deps').storages.get(image.storageId)
  if (!storage) throw storageNotFound('Storage not found')

  const trafficAllowed = await c.get('deps').quota.consumeTrafficIfQuotaAllows(image.orgId, image.size)
  if (!trafficAllowed) {
    await recordImageDownloadFailure(c, image, 'quota_exceeded')
    throw quotaExceeded('Traffic quota exceeded')
  }

  let url: string
  try {
    url = await c.get('deps').s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)
  } catch (e) {
    await c.get('deps').quota.refundTraffic(image.orgId, image.size)
    await recordImageDownloadFailure(c, image, 'presign_failed')
    throw e
  }

  const trafficEventId = createTrafficEventId()
  const trafficReportError = await reportTrafficForDownload(c, {
    orgId: image.orgId,
    bytes: image.size,
    storage,
    source: 'custom_domain_image',
    sourceId: image.id,
    eventId: trafficEventId,
  })
  if (trafficReportError) {
    await recordImageDownloadFailure(c, image, 'insufficient_credits')
    return trafficReportError
  }
  try {
    await confirmDownloadTraffic(c.get('deps'), { eventId: trafficEventId })
  } catch (error) {
    await reverseDownloadTraffic(c.get('deps'), {
      orgId: image.orgId,
      bytes: image.size,
      eventId: trafficEventId,
    })
    await recordImageDownloadFailure(c, image, 'internal')
    throw error
  }

  try {
    await c.get('deps').imageHosting.incrementAccessCount(image.id)
  } catch (error) {
    console.error('[image-hosting-domain] incrementAccessCount failed:', error)
  }
  await recordDownloadIssued(
    c.get('deps').audit,
    { userId: null, actorType: 'anonymous', actorRef: null },
    'image_hosting_download',
    {
      orgId: image.orgId,
      targetType: 'image',
      targetId: image.id,
      targetName: image.path,
      bytes: image.size,
      source: 'custom_domain_image',
      metadata: { imageId: image.id, storageId: image.storageId },
    },
    trafficEventId,
  )
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

function recordImageDownloadFailure(
  c: Context<Env>,
  image: { id: string; orgId: string; path: string; size: number; storageId: string },
  reason: string,
): Promise<void> {
  return recordDownloadFailure(
    c.get('deps').audit,
    { userId: null, actorType: 'anonymous', actorRef: null },
    {
      orgId: image.orgId,
      targetType: 'image',
      targetId: image.id,
      targetName: image.path,
      bytes: image.size,
      source: 'custom_domain_image',
      metadata: { imageId: image.id, storageId: image.storageId },
    },
    reason,
  )
}

// biome-ignore lint/suspicious/noConfusingVoidType: Next returns void; union with Response is intentional
export async function imageHostingDomain(c: Context<Env>, next: Next): Promise<Response | void> {
  const rawHost = c.req.header('host')
  if (!rawHost) return next()

  const host = normalizeHost(rawHost)
  if (!host) return next()

  if (c.get('webDavMountPath') === '') return next()

  const appHosts = getAppHostCandidates(c)
  if (appHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return next()
  }

  const orgId = await c.get('deps').imageHosting.resolveCustomDomain(host)
  if (!orgId) return next()

  const virtualPath = c.req.path.replace(/^\/+/, '')
  if (!virtualPath) throw notFound('path required')

  return handleImageByPath(c, orgId, virtualPath)
}
