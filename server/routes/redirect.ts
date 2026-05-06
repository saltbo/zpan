import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Storage as S3Storage } from '../../shared/types'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import { consumeTrafficIfQuotaAllows, hasTrafficQuotaForBytes } from '../services/effective-quota'
import { incrementAccessCount, resolveActiveImageByToken } from '../services/image-hosting'
import {
  decrementDownloads,
  hasDownloadsAvailable,
  incrementDownloadsAtomic,
  resolveShareByToken,
} from '../services/share'
import { getStorage } from '../services/storage'
import { PRESIGN_TTL_SECS, s3 } from './share-utils'

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

async function handleDirectShare(c: Context<Env>, db: Database, token: string): Promise<Response> {
  const resolved = await resolveShareByToken(db, token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
    return c.json({ error: 'Share not found or revoked' }, 404)
  }

  const { share, matter } = resolved
  if (share.kind !== 'direct') return c.json({ error: 'Share not found or revoked' }, 404)

  if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

  if (!(await hasDownloadsAvailable(db, share.id))) return c.json({ error: 'Download limit exceeded' }, 410)

  const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  if (!(await hasTrafficQuotaForBytes(db, share.orgId, matter.size ?? 0))) {
    return c.json({ error: 'Traffic quota exceeded' }, 422)
  }

  const url = await s3.presignDownload(storage, matter.object, matter.name, PRESIGN_TTL_SECS)

  const { ok } = await incrementDownloadsAtomic(db, share.id)
  if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

  const trafficAllowed = await consumeTrafficIfQuotaAllows(db, share.orgId, matter.size ?? 0)
  if (!trafficAllowed) {
    await decrementDownloads(db, share.id)
    return c.json({ error: 'Traffic quota exceeded' }, 422)
  }

  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function handleImageHosting(c: Context<Env>, db: Database, token: string): Promise<Response> {
  const resolved = await resolveActiveImageByToken(db, token)
  if (!resolved) return c.json({ error: 'Not found' }, 404)

  const { image, refererAllowlist } = resolved
  const refererHeader = c.req.header('Referer') ?? null

  // Allow same-origin requests (e.g. Web UI viewing its own images)
  const requestOrigin = new URL(c.req.url).origin
  const isSameOrigin = refererHeader ? new URL(refererHeader).origin === requestOrigin : false

  if (!isSameOrigin && !checkReferer(refererAllowlist, refererHeader)) {
    return c.json({ error: 'forbidden referer' }, 403)
  }

  const storage = (await getStorage(db, image.storageId)) as unknown as S3Storage
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  if (!(await hasTrafficQuotaForBytes(db, image.orgId, image.size))) {
    return c.json({ error: 'Traffic quota exceeded' }, 422)
  }

  const url = await s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)

  const trafficAllowed = await consumeTrafficIfQuotaAllows(db, image.orgId, image.size)
  if (!trafficAllowed) return c.json({ error: 'Traffic quota exceeded' }, 422)
  await incrementAccessCount(db, image.id)

  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

const app = new Hono<Env>().get('/:token', async (c) => {
  const raw = c.req.param('token')
  const token = stripExtension(raw)
  const db = c.get('platform').db

  if (token.startsWith('ds_')) return handleDirectShare(c, db, token)
  if (token.startsWith('ih_')) return handleImageHosting(c, db, token)

  return c.json({ error: 'Not found' }, 404)
})

export default app
