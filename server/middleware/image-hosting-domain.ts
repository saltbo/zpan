import type { Context, Next } from 'hono'
import { ZPAN_CLOUD_URL_DEFAULT } from '../../shared/constants'
import { imageHostingNotFound } from '../http/image-hosting-not-found'
import { PRESIGN_TTL_SECS } from '../http/share-utils'
import type { Env } from '../middleware/platform'
import type { Platform } from '../platform/interface'
import type { Deps } from '../usecases/deps'
import { cacheVerifiedImageDomain, resolveCachedImageDomain } from '../usecases/image-hosting/domain-cache'
import { forbidden, insufficientCredits, notFound, quotaExceeded, storageNotFound } from '../usecases/ports'
import {
  confirmDownloadTraffic,
  reportDownloadEgress,
  reverseDownloadTraffic,
} from '../usecases/store/traffic-metering'
import { createTrafficEventId, recordDownloadFailure, recordDownloadIssued } from '../usecases/transfer-activity'

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
  const publicOrigin = c.get('sitePublicOrigin')
  if (publicOrigin) {
    candidates.push(new URL(publicOrigin).hostname.toLowerCase())
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

async function handleImageByPath(
  request: Request,
  deps: Deps,
  platform: Platform,
  orgId: string,
  virtualPath: string,
): Promise<Response> {
  const resolved = await deps.imageHosting.resolveActiveByOrgPath(orgId, virtualPath)
  if (!resolved) return imageHostingNotFound(request)

  const { image, refererAllowlist } = resolved

  const refererHeader = request.headers.get('Referer')
  if (!checkReferer(refererAllowlist, refererHeader)) {
    throw forbidden('forbidden referer')
  }

  const storage = await deps.storages.get(image.storageId)
  if (!storage) throw storageNotFound('Storage not found')

  const trafficAllowed = await deps.quota.consumeTrafficIfQuotaAllows(image.orgId, image.size)
  if (!trafficAllowed) {
    await recordImageDownloadFailure(deps, image, 'quota_exceeded')
    throw quotaExceeded('Traffic quota exceeded')
  }

  let url: string
  try {
    url = await deps.s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)
  } catch (e) {
    await deps.quota.refundTraffic(image.orgId, image.size)
    await recordImageDownloadFailure(deps, image, 'presign_failed')
    throw e
  }

  const trafficEventId = createTrafficEventId()
  const trafficOutcome = await reportDownloadEgress(deps, {
    cloudBaseUrl: platform.getEnv('ZPAN_CLOUD_URL') ?? ZPAN_CLOUD_URL_DEFAULT,
    orgId: image.orgId,
    bytes: image.size,
    storage,
    source: 'custom_domain_image',
    sourceId: image.id,
    eventId: trafficEventId,
  })
  if (!trafficOutcome.ok) {
    await recordImageDownloadFailure(deps, image, 'insufficient_credits')
    throw insufficientCredits('Insufficient credits', { metadata: { resource: 'storage_egress' } })
  }
  try {
    await confirmDownloadTraffic(deps, { eventId: trafficEventId })
  } catch (error) {
    await reverseDownloadTraffic(deps, {
      orgId: image.orgId,
      bytes: image.size,
      eventId: trafficEventId,
    })
    await recordImageDownloadFailure(deps, image, 'internal')
    throw error
  }

  try {
    await deps.imageHosting.incrementAccessCount(image.id)
  } catch (error) {
    console.error('[image-hosting-domain] incrementAccessCount failed:', error)
  }
  await recordDownloadIssued(
    deps,
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
  return new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': 'no-store',
      Location: url,
    },
  })
}

function recordImageDownloadFailure(
  deps: Deps,
  image: { id: string; orgId: string; path: string; size: number; storageId: string },
  reason: string,
): Promise<void> {
  return recordDownloadFailure(
    deps,
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

export interface ImageHostingDomainRequestOptions {
  request: Request
  deps: Deps
  platform: Platform
  appHosts: string[]
  webDavMountPath: string
}

export async function handleImageHostingDomainRequest({
  request,
  deps,
  platform,
  appHosts,
  webDavMountPath,
}: ImageHostingDomainRequestOptions): Promise<Response | null> {
  const path = requestPath(request)
  if (isApplicationPath(path)) return null

  const rawHost = request.headers.get('host') ?? new URL(request.url).host
  const host = normalizeHost(rawHost)
  if (!host || webDavMountPath === '') return null

  if (
    appHosts.some((candidate) => host === candidate || (candidate === 'workers.dev' && host.endsWith('.workers.dev')))
  ) {
    return null
  }

  const verificationPrefix = '/.well-known/zpan-domain-verification/'
  if (request.method === 'GET' && path.startsWith(verificationPrefix)) {
    const token = path.slice(verificationPrefix.length)
    const [row, provider] = await Promise.all([
      deps.imageHostingConfigs.getByDomain(host),
      deps.imageDomains.getConfig(),
    ])
    if (
      row?.customDomain &&
      row.domainProvider === 'manual' &&
      row.verificationToken === token &&
      provider?.settings.enabled &&
      provider.settings.provider === 'manual' &&
      provider.lastTestedAt &&
      !provider.error
    ) {
      const now = new Date()
      await deps.imageHostingConfigs.update(row.orgId, {
        domainStatus: 'verified',
        domainError: null,
        domainLastCheckedAt: now,
        domainVerifiedAt: now,
      })
      await cacheVerifiedImageDomain(deps, host, row.orgId)
      return new Response(token, {
        status: 200,
        headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=UTF-8' },
      })
    }
    throw notFound('Domain verification not found')
  }

  const orgId = await resolveCachedImageDomain(deps, host)
  if (!orgId) return null

  const virtualPath = path.replace(/^\/ih(?:\/|$)/, '').replace(/^\/+/, '')
  if (!virtualPath) return imageHostingNotFound(request)

  return handleImageByPath(request, deps, platform, orgId, virtualPath)
}

// biome-ignore lint/suspicious/noConfusingVoidType: Next returns void; union with Response is intentional
export async function imageHostingDomain(c: Context<Env>, next: Next): Promise<Response | void> {
  const response = await handleImageHostingDomainRequest({
    request: c.req.raw,
    deps: c.get('deps'),
    platform: c.get('platform'),
    appHosts: getAppHostCandidates(c),
    webDavMountPath: c.get('webDavMountPath'),
  })
  return response ?? next()
}

function isApplicationPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/') || path === '/dav' || path.startsWith('/dav/')
}

function requestPath(request: Request): string {
  const path = new URL(request.url).pathname
  try {
    return decodeURI(path)
  } catch {
    return path
  }
}
