import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { removeAvatar, updateAvatar } from '../usecases/me'

// `/api/me/*` — resources scoped to the currently authenticated user.
// Kept separate from `/api/profiles/:username` which is the public read-only
// profile lookup.
export const me = new Hono<Env>()
  .use(requireAuth)
  .put('/avatar', async (c) => {
    // Multipart parsing + File extraction are http concerns; the usecase
    // receives the already-extracted File.
    const form = await c.req.formData().catch(() => null)
    if (!form) return c.json({ error: 'Expected multipart/form-data with a file field' }, 415)

    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)

    const result = await updateAvatar(c.get('deps'), {
      platform: c.get('platform'),
      userId: c.get('userId') as string,
      file,
    })
    if (!result.ok) return c.json({ error: result.error }, result.status)
    return c.json({ url: result.url })
  })
  .delete('/avatar', async (c) => {
    await removeAvatar(c.get('deps'), {
      platform: c.get('platform'),
      userId: c.get('userId') as string,
    })
    return c.json({ ok: true })
  })
