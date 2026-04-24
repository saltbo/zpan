import { Hono } from 'hono'
import { requireAdmin } from '../middleware/auth'
import type { Env } from '../middleware/platform'
import { requireFeature } from '../middleware/require-feature'
import {
  type BRANDING_KEYS,
  readBranding,
  resetBrandingField,
  setBrandingField,
  uploadBrandingImage,
} from '../services/branding'

type BrandingField = keyof typeof BRANDING_KEYS

const VALID_RESET_FIELDS = new Set<BrandingField>(['logo', 'favicon', 'wordmark_text', 'hide_powered_by'])

// Public — no auth required. Used on sign-in/sign-up pages too.
export const publicBranding = new Hono<Env>().get('/', async (c) => {
  const db = c.get('platform').db
  const config = await readBranding(db)
  return c.json(config)
})

// Admin — requires auth + admin role + white_label feature.
export const brandingAdmin = new Hono<Env>()
  .use(requireAdmin)
  .use(requireFeature('white_label'))
  .put('/', async (c) => {
    const platform = c.get('platform')

    // Multipart is not expressible via Hono RPC (same documented exception as avatar/team logo);
    // check content-type before calling formData() to give a clear 415 on wrong media type.
    if (!c.req.header('content-type')?.includes('multipart/form-data')) {
      return c.json({ error: 'Expected multipart/form-data' }, 415)
    }
    const form = await c.req.formData()

    const logoFile = form.get('logo')
    if (logoFile instanceof File && logoFile.size > 0) {
      const result = await uploadBrandingImage(platform, 'logo', logoFile)
      if (!result.ok) return c.json({ error: result.error }, result.status)
    }

    const faviconFile = form.get('favicon')
    if (faviconFile instanceof File && faviconFile.size > 0) {
      const result = await uploadBrandingImage(platform, 'favicon', faviconFile)
      if (!result.ok) return c.json({ error: result.error }, result.status)
    }

    const wordmarkRaw = form.get('wordmark_text')
    if (typeof wordmarkRaw === 'string') {
      if (wordmarkRaw.length > 24) return c.json({ error: 'wordmark_text must be 24 characters or fewer' }, 422)
      await setBrandingField(platform.db, 'wordmark_text', wordmarkRaw)
    }

    const hidePoweredByRaw = form.get('hide_powered_by')
    if (hidePoweredByRaw !== null) {
      const value = hidePoweredByRaw === 'true' || hidePoweredByRaw === '1' ? 'true' : 'false'
      await setBrandingField(platform.db, 'hide_powered_by', value)
    }

    return c.json(await readBranding(platform.db))
  })
  .delete('/:field', async (c) => {
    const rawField = c.req.param('field')
    if (!VALID_RESET_FIELDS.has(rawField as BrandingField)) {
      return c.json({ error: `Invalid field. Valid fields: ${[...VALID_RESET_FIELDS].join(', ')}` }, 400)
    }
    await resetBrandingField(c.get('platform').db, rawField as BrandingField)
    return c.json({ field: rawField, reset: true })
  })
