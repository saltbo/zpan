import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { type BrandingField, type BrandingThemeMode, isBrandingThemePresetId } from '../../../shared/types'
import { requireAdmin } from '../../middleware/auth'
import type { Env } from '../../middleware/platform'
import { requireFeature } from '../../middleware/require-feature'
import { AppError, badRequest, payloadTooLarge, unsupportedMediaType } from '../../usecases/ports'
import { applyBrandingUpdate, readBranding, resetBranding, type ThemeUpdate } from '../../usecases/site/branding'
import { errorResponse, jsonContent } from '../openapi'

const brandingThemeValuesSchema = z.object({
  primary_color: z.string(),
  primary_foreground: z.string(),
  canvas_color: z.string(),
  sidebar_accent_color: z.string(),
  ring_color: z.string(),
})

const brandingConfigSchema = z
  .object({
    logo_url: z.string().nullable(),
    favicon_url: z.string().nullable(),
    wordmark_text: z.string().nullable(),
    hide_powered_by: z.boolean(),
    theme: z.object({
      mode: z.string(),
      preset: z.string(),
      custom: brandingThemeValuesSchema.nullable(),
      configured: z.boolean(),
    }),
  })
  .openapi('BrandingConfig')

const VALID_RESET_FIELDS = new Set<BrandingField>([
  'logo',
  'favicon',
  'wordmark_text',
  'hide_powered_by',
  'theme',
  'theme_mode',
  'theme_preset',
  'theme_primary_color',
  'theme_primary_foreground',
  'theme_canvas_color',
  'theme_sidebar_accent_color',
  'theme_ring_color',
])

const CUSTOM_THEME_FIELDS = [
  'theme_primary_color',
  'theme_primary_foreground',
  'theme_canvas_color',
  'theme_sidebar_accent_color',
  'theme_ring_color',
] as const

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function parseThemeUpdate(form: FormData): { ok: true; values: ThemeUpdate } | { ok: false; error: string } {
  const values: ThemeUpdate = {}
  const mode = form.get('theme_mode')
  if (mode !== null) {
    if (mode !== 'preset' && mode !== 'custom') return { ok: false, error: 'theme_mode must be preset or custom' }
    values.theme_mode = mode as BrandingThemeMode
  }

  const preset = form.get('theme_preset')
  if (preset !== null) {
    if (typeof preset !== 'string' || !isBrandingThemePresetId(preset)) {
      return { ok: false, error: 'theme_preset is invalid' }
    }
    values.theme_preset = preset
  }

  for (const field of CUSTOM_THEME_FIELDS) {
    const value = form.get(field)
    if (value === null) continue
    if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) {
      return { ok: false, error: `${field} must be a CSS hex color` }
    }
    values[field] = value
  }

  if (values.theme_mode === 'custom') {
    for (const field of CUSTOM_THEME_FIELDS) {
      if (!values[field]) return { ok: false, error: `${field} is required for custom theme` }
    }
  }

  return { ok: true, values }
}

const readRoute = createRoute({
  operationId: 'getBranding',
  summary: 'Get branding',
  tags: ['Branding'],
  method: 'get',
  path: '/',
  responses: { 200: jsonContent(brandingConfigSchema, 'Branding config') },
})

const updateRoute = createRoute({
  operationId: 'updateBranding',
  summary: 'Update branding',
  tags: ['Branding'],
  method: 'put',
  path: '/',
  middleware: [requireAdmin, requireFeature('white_label')] as const,
  // Body is multipart/form-data (logo/favicon files + theme fields); parsed
  // directly in the handler rather than via a request schema (the form validator
  // conflicts with formData()).
  responses: {
    200: jsonContent(brandingConfigSchema, 'Updated branding'),
    400: errorResponse('Invalid upload'),
    413: errorResponse('File too large'),
    415: errorResponse('Expected multipart/form-data'),
    422: errorResponse('Invalid theme or wordmark'),
  },
})

const resetRoute = createRoute({
  operationId: 'resetBrandingField',
  summary: 'Reset a branding field',
  tags: ['Branding'],
  method: 'delete',
  path: '/{field}',
  middleware: [requireAdmin, requireFeature('white_label')] as const,
  request: { params: z.object({ field: z.string() }) },
  responses: {
    204: { description: 'Reset field' },
    400: errorResponse('Invalid field'),
  },
})

// Public — no auth required. Used on sign-in/sign-up pages too.
export const publicBranding = new OpenAPIHono<Env>().openapi(readRoute, async (c) =>
  c.json(await readBranding(c.get('deps')), 200),
)

// Admin — requires auth + admin role + white_label feature.
export const brandingAdmin = new OpenAPIHono<Env>()
  .openapi(updateRoute, async (c) => {
    if (!c.req.header('content-type')?.includes('multipart/form-data')) {
      throw unsupportedMediaType('Expected multipart/form-data')
    }
    const form = await c.req.formData()

    const themeUpdate = parseThemeUpdate(form)
    if (!themeUpdate.ok) throw new AppError(422, themeUpdate.error)

    const wordmarkRaw = form.get('wordmark_text')
    if (typeof wordmarkRaw === 'string' && wordmarkRaw.length > 24) {
      throw new AppError(422, 'wordmark_text must be 24 characters or fewer')
    }

    const hidePoweredByRaw = form.get('hide_powered_by')
    const logoFile = form.get('logo')
    const faviconFile = form.get('favicon')

    const result = await applyBrandingUpdate(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      logoFile: logoFile instanceof File && logoFile.size > 0 ? logoFile : null,
      faviconFile: faviconFile instanceof File && faviconFile.size > 0 ? faviconFile : null,
      wordmarkText: typeof wordmarkRaw === 'string' ? wordmarkRaw : null,
      hidePoweredBy: hidePoweredByRaw !== null ? hidePoweredByRaw === 'true' || hidePoweredByRaw === '1' : null,
      theme: themeUpdate.values,
    })
    if (!result.ok) {
      if (result.status === 413) throw payloadTooLarge(result.error)
      throw badRequest(result.error)
    }
    return c.json(result.config, 200)
  })
  .openapi(resetRoute, async (c) => {
    const rawField = c.req.valid('param').field
    if (!VALID_RESET_FIELDS.has(rawField as BrandingField)) {
      throw badRequest(`Invalid field. Valid fields: ${[...VALID_RESET_FIELDS].join(', ')}`)
    }
    await resetBranding(c.get('deps'), {
      userId: c.get('userId')!,
      orgId: c.get('orgId')!,
      field: rawField as BrandingField,
    })
    return c.body(null, 204)
  })
