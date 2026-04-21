import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Storage as S3Storage } from '../../shared/types'
import type { Env } from '../middleware/platform'
import type { Database } from '../platform/interface'
import { incrementAccessCount, resolveActiveImageByToken } from '../services/image-hosting'
import { incrementDownloadsAtomic, resolveShareByToken } from '../services/share'
import { getStorage } from '../services/storage'
import { PRESIGN_TTL_SECS, s3 } from './share-utils'

// Strip optional file extension from token (e.g. "ih_aB3xK9.png" → "ih_aB3xK9")
function stripExtension(token: string): string {
  const dot = token.lastIndexOf('.')
  return dot > 0 ? token.slice(0, dot) : token
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

// max-age is min(PRESIGN_TTL_SECS - 30, 300) to avoid caching beyond presign validity
const IMAGE_MAX_AGE = Math.min(PRESIGN_TTL_SECS - 30, 300)

async function handleDirectShare(c: Context<Env>, db: Database, token: string): Promise<Response> {
  const resolved = await resolveShareByToken(db, token)
  if (resolved.status !== 'ok') {
    if (resolved.status === 'matter_trashed') return c.json({ error: 'File no longer available' }, 410)
    return c.json({ error: 'Share not found or revoked' }, 404)
  }

  const { share, matter } = resolved
  if (share.kind !== 'direct') return c.json({ error: 'Share not found or revoked' }, 404)

  if (share.expiresAt && share.expiresAt < new Date()) return c.json({ error: 'Share has expired' }, 410)

  const { ok } = await incrementDownloadsAtomic(db, share.id)
  if (!ok) return c.json({ error: 'Download limit exceeded' }, 410)

  const storage = (await getStorage(db, matter.storageId)) as unknown as S3Storage
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  const url = await s3.presignDownload(storage, matter.object, matter.name, PRESIGN_TTL_SECS)
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

async function handleImageHosting(c: Context<Env>, db: Database, token: string): Promise<Response> {
  const resolved = await resolveActiveImageByToken(db, token)
  if (!resolved) return c.json({ error: 'Not found' }, 404)

  const { image, refererAllowlist } = resolved
  const refererHeader = c.req.header('Referer') ?? null

  if (!checkReferer(refererAllowlist, refererHeader)) {
    return c.json({ error: 'forbidden referer' }, 403)
  }

  const storage = (await getStorage(db, image.storageId)) as unknown as S3Storage
  if (!storage) return c.json({ error: 'Storage not found' }, 404)

  await incrementAccessCount(db, image.id)

  const url = await s3.presignInline(storage, image.storageKey, image.mime, PRESIGN_TTL_SECS)
  const res = c.redirect(url, 302)
  res.headers.set('Cache-Control', `public, max-age=${IMAGE_MAX_AGE}`)
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
