import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Env } from '../middleware/platform'
import { PRESIGN_TTL_SECS, s3 } from './share-utils'
import { consumeAndReportDownloadTraffic, reportTrafficForDownload } from './traffic-metering-utils'

// Strip optional file extension from token (e.g. "ih_aB3xK9.png" → "ih_aB3xK9")
function stripExtension(token: string): string {
  const dot = token.lastIndexOf('.')
  return dot > 0 ? token.slice(0, dot) : token
}

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

async function handleDirectShare(c: Context<Env>, token: string): Promise<Response> {
  const resolved = await c.get('deps').share.resolveByToken(token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
    return c.json({ error: 'Share not found or revoked' }, 404)
  }

  const { share, matter } = resolved
  if (share.kind !== 'direct') return c.json({ error: 'Share not found or revoked' }, 404)

  if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

  if (!(await c.get('deps').share.hasDownloadsAvailable(share.id)))
    return c.json({ error: 'Download limit exceeded' }, 410)

  const storage = await c.get('deps').storages.get(matter.storageId)
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  const { ok } = await c.get('deps').share.incrementDownloadsAtomic(share.id)
  if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

  const trafficError = await consumeAndReportDownloadTraffic(c, {
    orgId: share.orgId,
    bytes: matter.size ?? 0,
    storage,
    source: 'direct_share',
    sourceId: share.id,
    quotaExceeded: () => c.json({ error: 'Traffic quota exceeded' }, 422),
    onRejected: () => c.get('deps').share.decrementDownloads(share.id),
  })
  if (trafficError) return trafficError

  let url: string
  try {
    url = await s3.presignDownload(storage, matter.object, matter.name, PRESIGN_TTL_SECS)
  } catch (e) {
    await c.get('deps').quota.refundTraffic(share.orgId, matter.size ?? 0)
    await c.get('deps').share.decrementDownloads(share.id)
    throw e
  }

  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function handleImageHosting(c: Context<Env>, token: string): Promise<Response> {
  const resolved = await c.get('deps').imageHosting.resolveActiveByToken(token)
  if (!resolved) return c.json({ error: 'Not found' }, 404)

  const { image, refererAllowlist } = resolved
  const refererHeader = c.req.header('Referer') ?? null

  // Allow same-origin requests (e.g. Web UI viewing its own images)
  const requestOrigin = new URL(c.req.url).origin
  const isSameOrigin = refererHeader ? new URL(refererHeader).origin === requestOrigin : false

  if (!isSameOrigin && !checkReferer(refererAllowlist, refererHeader)) {
    return c.json({ error: 'forbidden referer' }, 403)
  }

  const storage = await c.get('deps').storages.get(image.storageId)
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  const trafficAllowed = await c.get('deps').quota.consumeTrafficIfQuotaAllows(image.orgId, image.size)
  if (!trafficAllowed) return c.json({ error: 'Traffic quota exceeded' }, 422)

  let url: string
  try {
    url = await s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)
  } catch (e) {
    await c.get('deps').quota.refundTraffic(image.orgId, image.size)
    throw e
  }

  const trafficReportError = await reportTrafficForDownload(c, {
    orgId: image.orgId,
    bytes: image.size,
    storage,
    source: 'image_hosting',
    sourceId: image.id,
  })
  if (trafficReportError) return trafficReportError

  try {
    await c.get('deps').imageHosting.incrementAccessCount(image.id)
  } catch (error) {
    console.error('[redirect] incrementAccessCount failed:', error)
  }
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

const app = new Hono<Env>().get('/:token', async (c) => {
  const raw = c.req.param('token')
  const token = stripExtension(raw)

  if (token.startsWith('ds_')) return handleDirectShare(c, token)
  if (token.startsWith('ih_')) return handleImageHosting(c, token)

  return c.json({ error: 'Not found' }, 404)
})

export default app
