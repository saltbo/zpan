import {
  type BrandingConfig,
  type BrandingField,
  type BrandingThemeConfig,
  type BrandingThemeMode,
  isBrandingThemePresetId,
} from '@shared/types'
import type { SystemOptionsRepo } from '../ports'

export type BrandingDeps = {
  systemOptions: SystemOptionsRepo
}

const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const
const FAVICON_MIMES = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'] as const
// Caps apply to the raw uploaded bytes. Base64 inflates them by roughly 33%, so
// the limits also keep the public configz payload small.
export const MAX_LOGO_SIZE = 256 * 1024 // 256 KB
export const MAX_FAVICON_SIZE = 64 * 1024 // 64 KB

export const BRANDING_KEYS = {
  logo: 'branding_logo_url',
  favicon: 'branding_favicon_url',
  wordmark_text: 'branding_wordmark_text',
  hide_powered_by: 'branding_hide_powered_by',
  theme_mode: 'branding_theme_mode',
  theme_preset: 'branding_theme_preset',
  theme_primary_color: 'branding_theme_primary_color',
  theme_primary_foreground: 'branding_theme_primary_foreground',
  theme_canvas_color: 'branding_theme_canvas_color',
  theme_sidebar_accent_color: 'branding_theme_sidebar_accent_color',
  theme_ring_color: 'branding_theme_ring_color',
} as const

const THEME_KEYS = [
  'theme_mode',
  'theme_preset',
  'theme_primary_color',
  'theme_primary_foreground',
  'theme_canvas_color',
  'theme_sidebar_accent_color',
  'theme_ring_color',
] as const

export type ThemeField = (typeof THEME_KEYS)[number]
export type ThemeUpdate = Partial<Record<ThemeField, string>>

export type BrandingUploadResult = { ok: true; url: string } | { ok: false; status: 400 | 413; error: string }

// The parsed, already-validated PUT payload. Multipart parsing, theme/color
// validation, and the wordmark-length check are http concerns; this usecase
// receives the extracted Files and primitive values and owns every write +
// the audit decision.
export type BrandingUpdateInput = {
  logoFile: File | null
  faviconFile: File | null
  wordmarkText: string | null
  hidePoweredBy: boolean | null
  theme: ThemeUpdate
}

// On an image-upload failure the handler maps `status`/`error` straight to its
// response (400 invalid type, 413 too large). On success the freshly-read config
// is returned for serialization.
export type BrandingUpdateOutcome =
  | { ok: true; config: BrandingConfig; changedFields: string[] }
  | { ok: false; status: 400 | 413; error: string }

export async function readBranding(deps: Pick<BrandingDeps, 'systemOptions'>): Promise<BrandingConfig> {
  const keys = Object.values(BRANDING_KEYS)
  const rows = await deps.systemOptions.listByPrefix('branding_')
  const map = new Map(rows.filter((r) => (keys as readonly string[]).includes(r.key)).map((r) => [r.key, r.value]))
  const configured = THEME_KEYS.some((field) => map.has(BRANDING_KEYS[field]))
  const mode = readThemeMode(map.get(BRANDING_KEYS.theme_mode))
  const preset = readThemePreset(map.get(BRANDING_KEYS.theme_preset))

  return {
    logo_url: map.get(BRANDING_KEYS.logo) ?? null,
    favicon_url: map.get(BRANDING_KEYS.favicon) ?? null,
    wordmark_text: map.get(BRANDING_KEYS.wordmark_text) ?? null,
    hide_powered_by: map.get(BRANDING_KEYS.hide_powered_by) === 'true',
    theme: {
      mode,
      preset,
      custom: readCustomTheme(map),
      configured,
    } satisfies BrandingThemeConfig,
  }
}

// Orchestrates the whole admin PUT: uploads each supplied image (short-circuit on
// the first failure, preserving logo-before-favicon ordering), persists the
// scalar + theme fields, records a single audit event when anything changed, and
// returns the re-read config. Mirrors the prior inline handler order exactly.
export async function applyBrandingUpdate(
  deps: BrandingDeps,
  input: BrandingUpdateInput,
): Promise<BrandingUpdateOutcome> {
  const { logoFile, faviconFile, wordmarkText, hidePoweredBy, theme } = input
  const changedFields: string[] = []

  if (logoFile) {
    const result = await uploadBrandingImage(deps, 'logo', logoFile)
    if (!result.ok) return { ok: false, status: result.status, error: result.error }
    changedFields.push('logo')
  }

  if (faviconFile) {
    const result = await uploadBrandingImage(deps, 'favicon', faviconFile)
    if (!result.ok) return { ok: false, status: result.status, error: result.error }
    changedFields.push('favicon')
  }

  if (wordmarkText !== null) {
    await setBrandingField(deps, 'wordmark_text', wordmarkText)
    changedFields.push('wordmark_text')
  }

  if (hidePoweredBy !== null) {
    await setBrandingField(deps, 'hide_powered_by', hidePoweredBy ? 'true' : 'false')
    changedFields.push('hide_powered_by')
  }

  for (const [field, value] of Object.entries(theme) as [ThemeField, string][]) {
    await setBrandingField(deps, field, value)
    changedFields.push(field)
  }

  return { ok: true, config: await readBranding(deps), changedFields }
}

// Resets one branding field and audits it. A `theme*` field clears the entire
// theme (mode + preset + every custom color) — resetting any single theme knob
// returns the workspace to the unconfigured default. `field` is already
// validated against the allow-list by the http layer.
export async function resetBranding(deps: BrandingDeps, params: { field: BrandingField }): Promise<void> {
  const { field } = params
  if (field.startsWith('theme')) {
    await resetBrandingTheme(deps)
  } else {
    await resetBrandingField(deps, field as keyof typeof BRANDING_KEYS)
  }
}

// Encodes the uploaded file as a `data:` URI and stores it in the branding
// system option. No S3 / public storage is involved — the data URI is served
// inline by the public, cached GET /api/site/branding.
export async function uploadBrandingImage(
  deps: Pick<BrandingDeps, 'systemOptions'>,
  field: 'logo' | 'favicon',
  file: File,
): Promise<BrandingUploadResult> {
  const allowedMimes = field === 'logo' ? LOGO_MIMES : FAVICON_MIMES
  if (!(allowedMimes as readonly string[]).includes(file.type)) {
    return { ok: false, status: 400, error: `Invalid file type for ${field}. Allowed: ${allowedMimes.join(', ')}` }
  }
  const maxSize = field === 'logo' ? MAX_LOGO_SIZE : MAX_FAVICON_SIZE
  if (file.size > maxSize) {
    const label = field === 'logo' ? 'Logo' : 'Favicon'
    return { ok: false, status: 413, error: `${label} too large. Max ${maxSize / 1024} KB.` }
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const url = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`

  await deps.systemOptions.set(BRANDING_KEYS[field], url)
  return { ok: true, url }
}

export async function setBrandingField(
  deps: Pick<BrandingDeps, 'systemOptions'>,
  field: 'wordmark_text' | 'hide_powered_by' | ThemeField,
  value: string,
): Promise<void> {
  await deps.systemOptions.set(BRANDING_KEYS[field], value)
}

export async function resetBrandingField(
  deps: Pick<BrandingDeps, 'systemOptions'>,
  field: keyof typeof BRANDING_KEYS,
): Promise<void> {
  await deps.systemOptions.delete(BRANDING_KEYS[field])
}

export async function resetBrandingTheme(deps: Pick<BrandingDeps, 'systemOptions'>): Promise<void> {
  for (const field of THEME_KEYS) {
    await deps.systemOptions.delete(BRANDING_KEYS[field])
  }
}

function readThemeMode(value: string | undefined): BrandingThemeMode {
  return value === 'custom' ? 'custom' : 'preset'
}

function readThemePreset(value: string | undefined) {
  return value && isBrandingThemePresetId(value) ? value : 'default'
}

function readCustomTheme(map: Map<string, string>) {
  const primaryColor = map.get(BRANDING_KEYS.theme_primary_color)
  const primaryForeground = map.get(BRANDING_KEYS.theme_primary_foreground)
  const canvasColor = map.get(BRANDING_KEYS.theme_canvas_color)
  const sidebarAccentColor = map.get(BRANDING_KEYS.theme_sidebar_accent_color)
  const ringColor = map.get(BRANDING_KEYS.theme_ring_color)
  if (!primaryColor || !primaryForeground || !canvasColor || !sidebarAccentColor || !ringColor) return null
  return {
    primary_color: primaryColor,
    primary_foreground: primaryForeground,
    canvas_color: canvasColor,
    sidebar_accent_color: sidebarAccentColor,
    ring_color: ringColor,
  }
}
