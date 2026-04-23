import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { user } from '../db/auth-schema'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { deletePublicImageVariants, uploadPublicImage } from '../services/image-upload'

const AVATAR_PREFIX = '_system/avatars'

// `/api/me/*` — resources scoped to the currently authenticated user.
// Kept separate from `/api/profiles/:username` which is the public read-only
// profile lookup.
export const me = new Hono<Env>()
  .use(requireAuth)
  .put('/avatar', async (c) => {
    const platform = c.get('platform')
    const userId = c.get('userId') as string

    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'Expected multipart/form-data with a file field' }, 415)

    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)

    const result = await uploadPublicImage(platform, AVATAR_PREFIX, userId, file)
    if (!result.ok) return c.json({ error: result.error }, result.status)

    await platform.db.update(user).set({ image: result.url }).where(eq(user.id, userId))
    return c.json({ url: result.url })
  })
  .delete('/avatar', async (c) => {
    const platform = c.get('platform')
    const userId = c.get('userId') as string

    // Clear DB first (authoritative); storage cleanup below is best-effort.
    await platform.db.update(user).set({ image: null }).where(eq(user.id, userId))
    await deletePublicImageVariants(platform, AVATAR_PREFIX, userId)
    return c.json({ ok: true })
  })
