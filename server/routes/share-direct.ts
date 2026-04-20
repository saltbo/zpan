import { Hono } from 'hono'
import type { Storage as S3Storage } from '../../shared/types'
import type { Env } from '../middleware/platform'
import { incrementDownloadsAtomic, resolveShareByToken } from '../services/share'
import { getStorage } from '../services/storage'
import { PRESIGN_TTL_SECS, s3 } from './share-utils'

const app = new Hono<Env>().get('/:token', async (c) => {
  const token = c.req.param('token')
  const db = c.get('platform').db

  const resolved = await resolveShareByToken(db, token)
  if (!resolved.found) {
    if (resolved.reason === 'trashed') return c.json({ error: 'File no longer available' }, 410)
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
})

export default app
