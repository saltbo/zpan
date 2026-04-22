import { zValidator } from '@hono/zod-validator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { AVATAR_MIMES, commitAvatarSchema, requestAvatarUploadSchema } from '../../shared/schemas'
import type { Storage as S3Storage } from '../../shared/types'
import { user } from '../db/auth-schema'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { getUserByUsername } from '../services/profile'
import { S3Service } from '../services/s3'
import { selectStorage } from '../services/storage'

const s3 = new S3Service()

const MIME_TO_EXT: Record<(typeof AVATAR_MIMES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function avatarKey(userId: string, mime: (typeof AVATAR_MIMES)[number]): string {
  return `_system/avatars/${userId}.${MIME_TO_EXT[mime]}`
}

const app = new Hono<Env>()
  .get('/:username', async (c) => {
    const db = c.get('platform').db
    const { username } = c.req.param()
    const profileUser = await getUserByUsername(db, username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)
    return c.json({ user: profileUser, shares: [] })
  })
  .get('/:username/browse', async (c) => {
    const db = c.get('platform').db
    const { username } = c.req.param()
    const profileUser = await getUserByUsername(db, username)
    if (!profileUser) return c.json({ error: 'User not found' }, 404)
    return c.json({ items: [], breadcrumb: [] })
  })

export default app

// ── Authenticated profile endpoints ──────────────────────────────────────────
// Avatars must be publicly viewable — select public-mode storage whose bucket
// is expected to allow unauthenticated GET (public-read ACL or equivalent).

export const profileMe = new Hono<Env>()
  .post('/avatar', requireAuth, zValidator('json', requestAvatarUploadSchema), async (c) => {
    const userId = c.get('userId') as string
    const { mime, size: _size } = c.req.valid('json')
    // size is validated by schema (≤ MAX_AVATAR_SIZE); no manual check needed.

    const db = c.get('platform').db
    let storage: S3Storage
    try {
      storage = (await selectStorage(db, 'public')) as unknown as S3Storage
    } catch (err) {
      console.warn('[profile/avatar] no public storage available:', err)
      return c.json({ error: 'No public storage configured for avatars' }, 503)
    }

    const key = avatarKey(userId, mime)
    const uploadUrl = await s3.presignUpload(storage, key, mime)

    return c.json({ uploadUrl, key }, 201)
  })
  .post('/avatar/commit', requireAuth, zValidator('json', commitAvatarSchema), async (c) => {
    const userId = c.get('userId') as string
    const { mime } = c.req.valid('json')

    const db = c.get('platform').db
    let storage: S3Storage
    try {
      storage = (await selectStorage(db, 'public')) as unknown as S3Storage
    } catch (err) {
      console.warn('[profile/avatar/commit] no public storage available:', err)
      return c.json({ error: 'No public storage configured for avatars' }, 503)
    }

    const key = avatarKey(userId, mime)
    try {
      await s3.headObject(storage, key)
    } catch {
      return c.json({ error: 'Avatar object not found. Upload the file first.' }, 400)
    }

    // getPublicUrl assumes the bucket has public-read access (public-mode storage).
    const imageUrl = s3.getPublicUrl(storage, key)
    await db.update(user).set({ image: imageUrl }).where(eq(user.id, userId))

    return c.json({ image: imageUrl })
  })
  .delete('/avatar', requireAuth, async (c) => {
    const userId = c.get('userId') as string
    const db = c.get('platform').db

    // Clear the DB reference first — this is the authoritative action.
    // S3 cleanup below is best-effort; orphaned objects are acceptable.
    await db.update(user).set({ image: null }).where(eq(user.id, userId))

    try {
      const storage = (await selectStorage(db, 'public')) as unknown as S3Storage
      // Delete all possible extension variants to avoid orphaned objects when
      // the user has previously changed their avatar MIME type.
      await Promise.allSettled(AVATAR_MIMES.map((mime) => s3.deleteObject(storage, avatarKey(userId, mime))))
    } catch (err) {
      // No storage or unreachable — ignore; DB is already cleared.
      console.warn('[profile/avatar delete] S3 cleanup skipped:', err)
    }

    return c.json({ ok: true })
  })
